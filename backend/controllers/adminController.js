const mongoose = require("mongoose");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Mess = require("../models/Mess");
const DailyReport = require("../models/DailyReport");
const { localDateStr, dateDaysAgoStr } = require("../utils/dateHelpers");
const { normalizeMealType, finalizedCostMessage } = require("../utils/mealHelpers");
const { attachMenuToAttendanceRows } = require("../utils/attachHistoryMenu");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

function mealTypeFromRequest(req) {
  const m = req.query?.mealType ?? req.body?.mealType;
  return normalizeMealType(m);
}

function recordMatchesMeal(a, mealType) {
  const m = normalizeMealType(mealType);
  if (m === "dinner") return a.mealType === "dinner";
  return a.mealType === "lunch" || a.mealType == null;
}

function buildMealView(list, allEmployees, today, mealType) {
  const mt = normalizeMealType(mealType);
  const mealRecords = list.filter((a) => recordMatchesMeal(a, mt));
  const present = [];
  const presentUserIds = new Set();
  for (const a of mealRecords) {
    if (a.status !== "Present") continue;
    const name = a.userId?.fullName || "Unknown";
    const t = new Date(a.updatedAt || a.createdAt);
    const time = t.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const uid = a.userId?._id != null ? String(a.userId._id) : null;
    if (uid) {
      present.push({
        employeeName: name,
        time,
        employeeId: uid,
        date: today,
        mealType: mt,
      });
      presentUserIds.add(uid);
    }
  }
  const byUser = new Map();
  for (const a of mealRecords) {
    const uid = a.userId?._id != null ? String(a.userId._id) : null;
    if (uid) byUser.set(uid, a);
  }
  const absent = [];
  for (const emp of allEmployees) {
    const uid = String(emp._id);
    if (presentUserIds.has(uid)) continue;
    const n = emp.fullName || emp.username || "Unknown";
    let time = "—";
    const rec = byUser.get(uid);
    if (rec && rec.status === "Absent") {
      const t2 = new Date(rec.updatedAt || rec.createdAt);
      time = t2.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    }
    absent.push({
      employeeName: n,
      time,
      employeeId: uid,
      date: today,
      mealType: mt,
    });
  }
  return {
    present,
    absent,
    presentCount: present.length,
    absentCount: absent.length,
  };
}

function messKey(today, mealType) {
  return { date: today, mealType: normalizeMealType(mealType) };
}

async function todayMessIsFinalizedFor(mealType) {
  const m = await Mess.findOne(messKey(localDateStr(), mealType)).select("isFinalized").lean();
  return !!(m && m.isFinalized);
}

async function presentCountForDateAndMeal(dateStr, mealType) {
  const mt = normalizeMealType(mealType);
  if (mt === "dinner") {
    return Attendance.countDocuments({ date: dateStr, status: "Present", mealType: "dinner" });
  }
  return Attendance.countDocuments({
    date: dateStr,
    status: "Present",
    $or: [{ mealType: "lunch" }, { mealType: { $exists: false } }],
  });
}

async function getTodayAttendance(req, res) {
  try {
    const today = localDateStr();
    const list = await Attendance.find({ date: today }).populate("userId", "fullName username").lean();
    const totalEmployees = await User.countDocuments({ role: "employee" });
    const employees = await User.find({ role: "employee" }).select("_id fullName username").lean();

    const lunch = buildMealView(list, employees, today, "lunch");
    const dinner = buildMealView(list, employees, today, "dinner");

    return sendJson(res, 200, true, "Today's attendance fetched", {
      today,
      totalEmployees,
      todayPresentCount: lunch.presentCount,
      todayAbsentCount: lunch.absentCount,
      present: lunch.present,
      absent: lunch.absent,
      lunch: {
        present: lunch.present,
        absent: lunch.absent,
        presentCount: lunch.presentCount,
        absentCount: lunch.absentCount,
      },
      dinner: {
        present: dinner.present,
        absent: dinner.absent,
        presentCount: dinner.presentCount,
        absentCount: dinner.absentCount,
      },
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getEmployeeAttendanceHistory(req, res) {
  try {
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return sendJson(res, 400, false, "Invalid employee id", null);
    }
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const today = localDateStr();
    const fromDate = dateDaysAgoStr(days - 1);
    const records = await Attendance.find({
      userId: employeeId,
      date: { $gte: fromDate, $lte: today },
    })
      .sort({ date: -1, mealType: 1 })
      .lean();
    const recordsWithMenu = await attachMenuToAttendanceRows(Mess, records);
    const recordsOut = recordsWithMenu.map((r) => {
      const c = r.cost;
      const cost = c == null || c === "" || Number.isNaN(Number(c)) ? null : Number(c);
      return { ...r, cost };
    });
    return sendJson(res, 200, true, "OK", { records: recordsOut });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getEmployees(req, res) {
  try {
    const total = await User.countDocuments({ role: "employee" });
    const employees = await User.find({ role: "employee" }).select("fullName username").lean();
    return sendJson(res, 200, true, "OK", { total, employees });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

/** Normalize DB row to { _id?, name, quantity, price } (price = line total). */
function normalizeIngredientForSave(i) {
  if (!i) return null;
  const name = String(i.name || "").trim();
  if (!name) return null;
  const id = i._id;
  if (i.quantityKg != null || i.pricePerKg != null) {
    const qty = Number(i.quantityKg);
    const ppk = Number(i.pricePerKg);
    const line =
      i.total != null && !Number.isNaN(Number(i.total))
        ? Number(i.total)
        : (Number.isNaN(qty) ? 0 : qty) * (Number.isNaN(ppk) ? 0 : ppk);
    return {
      _id: id,
      name,
      quantity: String(Number.isNaN(qty) ? "" : qty),
      price: Math.round(line * 100) / 100,
    };
  }
  const qtyStr = String(i.quantity ?? "").trim();
  const price = Math.round((Number(i.price) || 0) * 100) / 100;
  return { _id: id, name, quantity: qtyStr, price };
}

function formatIngredientForClient(i) {
  const n = normalizeIngredientForSave(i);
  if (!n) return null;
  const qtyNum = parseFloat(String(n.quantity).replace(/[^\d.-]/g, "")) || 0;
  const line = Number(n.price) || 0;
  const pricePerKg = qtyNum > 0 ? line / qtyNum : 0;
  return {
    _id: n._id,
    name: n.name,
    quantity: n.quantity,
    price: n.price,
    quantityKg: qtyNum,
    pricePerKg,
    total: line,
  };
}

function formatMessForClient(mess) {
  if (!mess) return null;
  const m = mess.toObject ? mess.toObject() : mess;
  const totalCost = m.totalCost ?? m.totalExpense ?? 0;
  const ingredients = (m.ingredients || []).map(formatIngredientForClient).filter(Boolean);
  return {
    ...m,
    totalCost,
    totalExpense: totalCost,
    isFinalized: m.isFinalized === true,
    mealType: m.mealType != null ? m.mealType : "lunch",
    ingredients,
  };
}

async function patchMessMenu(req, res) {
  try {
    const mealType = mealTypeFromRequest(req);
    if (await todayMessIsFinalizedFor(mealType)) {
      return sendJson(res, 400, false, finalizedCostMessage(mealType), null);
    }
    const today = localDateStr();
    const messName = String(req.body.messName ?? "").trim();
    const doc = await Mess.findOneAndUpdate(
      messKey(today, mealType),
      { $set: { messName, mealType: normalizeMealType(mealType) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return sendJson(res, 200, true, "OK", { mess: formatMessForClient(doc) });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function addMessIngredient(req, res) {
  try {
    const mealType = mealTypeFromRequest(req);
    if (await todayMessIsFinalizedFor(mealType)) {
      return sendJson(res, 400, false, finalizedCostMessage(mealType), null);
    }
    const today = localDateStr();
    const { name, quantityKg, pricePerKg } = req.body;
    const nameTrim = String(name || "").trim();
    if (!nameTrim) {
      return sendJson(res, 400, false, "Ingredient name required", null);
    }
    const qty = Number(quantityKg);
    const ppk = Number(pricePerKg);
    if (Number.isNaN(qty) || qty < 0 || Number.isNaN(ppk) || ppk < 0) {
      return sendJson(res, 400, false, "Enter valid quantity and price", null);
    }
    const linePrice = Math.round(qty * ppk * 100) / 100;
    const key = messKey(today, mealType);
    const existing = await Mess.findOne(key).lean();
    const prev = (existing?.ingredients || []).map(normalizeIngredientForSave).filter(Boolean);
    const ingredients = [...prev, { name: nameTrim, quantity: String(qty), price: linePrice }];
    const present = await presentCountForDateAndMeal(today, mealType);
    const totalCost = ingredients.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costPerHead = present > 0 ? Math.round((totalCost / present) * 100) / 100 : 0;
    const doc = await Mess.findOneAndUpdate(
      key,
      {
        $set: {
          date: today,
          mealType: normalizeMealType(mealType),
          messName: existing?.messName ?? "",
          ingredients,
          totalCost,
          totalExpense: totalCost,
          costPerHead,
          assigned: false,
          presentCountAtAssign: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return sendJson(res, 200, true, "Ingredient added", { mess: formatMessForClient(doc) });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function updateMessIngredient(req, res) {
  try {
    const mealType = mealTypeFromRequest(req);
    if (await todayMessIsFinalizedFor(mealType)) {
      return sendJson(res, 400, false, finalizedCostMessage(mealType), null);
    }
    const { ingredientId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(ingredientId)) {
      return sendJson(res, 400, false, "Invalid ingredient id", null);
    }
    const today = localDateStr();
    const { name, quantityKg, pricePerKg } = req.body;
    const key = messKey(today, mealType);
    const existing = await Mess.findOne(key);
    if (!existing) {
      return sendJson(res, 404, false, "No mess for today", null);
    }
    const ingredients = (existing.ingredients || []).map(normalizeIngredientForSave).filter(Boolean);
    const idx = ingredients.findIndex((x) => String(x._id) === ingredientId);
    if (idx === -1) {
      return sendJson(res, 404, false, "Ingredient not found", null);
    }
    const nameTrim = String(name ?? ingredients[idx].name).trim();
    const qty = Number(quantityKg);
    const ppk = Number(pricePerKg);
    if (!nameTrim || Number.isNaN(qty) || qty < 0 || Number.isNaN(ppk) || ppk < 0) {
      return sendJson(res, 400, false, "Invalid ingredient data", null);
    }
    ingredients[idx] = {
      _id: ingredients[idx]._id,
      name: nameTrim,
      quantity: String(qty),
      price: Math.round(qty * ppk * 100) / 100,
    };
    const present = await presentCountForDateAndMeal(today, mealType);
    const totalCost = ingredients.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costPerHead = present > 0 ? Math.round((totalCost / present) * 100) / 100 : 0;
    const doc = await Mess.findOneAndUpdate(
      key,
      {
        $set: {
          ingredients,
          totalCost,
          totalExpense: totalCost,
          costPerHead,
          assigned: false,
          presentCountAtAssign: 0,
        },
      },
      { new: true }
    );
    return sendJson(res, 200, true, "Ingredient updated", { mess: formatMessForClient(doc) });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function deleteMessIngredient(req, res) {
  try {
    const mealType = mealTypeFromRequest(req);
    if (await todayMessIsFinalizedFor(mealType)) {
      return sendJson(res, 400, false, finalizedCostMessage(mealType), null);
    }
    const { ingredientId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(ingredientId)) {
      return sendJson(res, 400, false, "Invalid ingredient id", null);
    }
    const today = localDateStr();
    const key = messKey(today, mealType);
    const existing = await Mess.findOne(key);
    if (!existing) {
      return sendJson(res, 404, false, "No mess for today", null);
    }
    const ingredients = (existing.ingredients || [])
      .map(normalizeIngredientForSave)
      .filter(Boolean)
      .filter((x) => String(x._id) !== ingredientId);
    const present = await presentCountForDateAndMeal(today, mealType);
    const totalCost = ingredients.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costPerHead = present > 0 ? Math.round((totalCost / present) * 100) / 100 : 0;
    const doc = await Mess.findOneAndUpdate(
      key,
      {
        $set: {
          ingredients,
          totalCost,
          totalExpense: totalCost,
          costPerHead,
          assigned: false,
          presentCountAtAssign: 0,
        },
      },
      { new: true }
    );
    return sendJson(res, 200, true, "Ingredient removed", { mess: formatMessForClient(doc) });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function assignCost(req, res) {
  try {
    const today = localDateStr();
    const mealType = mealTypeFromRequest(req);
    const { date: bodyDate } = req.body || {};
    if (bodyDate != null && String(bodyDate) !== "" && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyDate))) {
      if (String(bodyDate) !== today) {
        return sendJson(res, 400, false, "Cost can only be assigned for today", null);
      }
    }

    if (await todayMessIsFinalizedFor(mealType)) {
      return sendJson(res, 400, false, finalizedCostMessage(mealType), null);
    }

    const key = messKey(today, mealType);
    const mess = await Mess.findOne(key);
    if (!mess) {
      return sendJson(res, 400, false, "No mess data for today. Add ingredients first.", null);
    }
    const base = mess.totalCost ?? mess.totalExpense ?? 0;
    if (base <= 0) {
      return sendJson(res, 400, false, "No ingredients / total cost is zero", null);
    }
    const presentCount = await presentCountForDateAndMeal(today, mealType);
    if (presentCount === 0) {
      return sendJson(res, 400, false, "No present employees to assign cost", null);
    }
    const costPerHead = Math.round((base / presentCount) * 100) / 100;

    const mt = normalizeMealType(mealType);
    if (mt === "dinner") {
      await Attendance.updateMany(
        { date: today, mealType: "dinner", status: "Present" },
        { $set: { cost: costPerHead } }
      );
      await Attendance.updateMany(
        { date: today, mealType: "dinner", status: "Absent" },
        { $set: { cost: 0 } }
      );
    } else {
      await Attendance.updateMany(
        {
          date: today,
          status: "Present",
          $or: [{ mealType: "lunch" }, { mealType: { $exists: false } }],
        },
        { $set: { cost: costPerHead } }
      );
      await Attendance.updateMany(
        {
          date: today,
          status: "Absent",
          $or: [{ mealType: "lunch" }, { mealType: { $exists: false } }],
        },
        { $set: { cost: 0 } }
      );
    }

    mess.costPerHead = costPerHead;
    mess.presentCountAtAssign = presentCount;
    mess.assigned = true;
    mess.isFinalized = true;
    await mess.save();

    const totalExpense = mess.totalCost ?? mess.totalExpense ?? base;
    await DailyReport.findOneAndUpdate(
      { date: today, mealType: mt },
      {
        $set: {
          date: today,
          mealType: mt,
          menu: mess.messName || "",
          totalExpense,
          presentCount,
          costPerHead,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return sendJson(res, 200, true, "Cost assigned", { mess: formatMessForClient(mess) });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getTodayMess(req, res) {
  try {
    const today = localDateStr();
    const mealType = req.query?.mealType != null ? req.query.mealType : "lunch";
    const mess = await Mess.findOne(messKey(today, mealType)).lean();
    return sendJson(res, 200, true, "OK", { mess: formatMessForClient(mess) });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getReports(req, res) {
  try {
    const startDate = req.query.startDate || req.query.from;
    const endDate = req.query.endDate || req.query.to;
    if (!startDate || !endDate) {
      return sendJson(res, 400, false, "from and to (or startDate and endDate) required (YYYY-MM-DD)", null);
    }
    const rows = await DailyReport.find({
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: -1, mealType: 1 })
      .lean();
    const reports = rows.map((d) => {
      const totalExpense = Number(d.totalExpense) || 0;
      return {
        date: d.date,
        mealType: d.mealType != null ? d.mealType : "lunch",
        mess: d.menu != null && String(d.menu) !== "" ? d.menu : "—",
        totalExpense,
        totalCost: totalExpense,
        presentCount: d.presentCount,
        costPerHead: d.costPerHead,
        ingredients: [],
      };
    });
    return sendJson(res, 200, true, "OK", { reports });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = {
  getTodayAttendance,
  getEmployeeAttendanceHistory,
  getEmployees,
  getTodayMess,
  patchMessMenu,
  addMessIngredient,
  updateMessIngredient,
  deleteMessIngredient,
  assignCost,
  getReports,
};
