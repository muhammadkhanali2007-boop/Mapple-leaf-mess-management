const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Mess = require("../models/Mess");
const { localDateStr } = require("../utils/dateHelpers");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

async function getTodayAttendance(req, res) {
  try {
    const today = localDateStr();
    const list = await Attendance.find({ date: today }).populate("userId", "fullName username").lean();
    const totalEmployees = await User.countDocuments({ role: "employee" });
    const present = [];
    const absent = [];
    for (const a of list) {
      const name = a.userId?.fullName || "Unknown";
      const t = new Date(a.updatedAt || a.createdAt);
      const time = t.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const row = { employeeName: name, time };
      if (a.status === "Present") present.push(row);
      else absent.push(row);
    }
    return sendJson(res, 200, true, "Today's attendance fetched", {
      today,
      totalEmployees,
      todayPresentCount: present.length,
      todayAbsentCount: absent.length,
      present,
      absent,
    });
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

async function saveMess(req, res) {
  try {
    const { messName, menu, ingredients } = req.body;
    const today = localDateStr();
    const name = String(messName || menu || "").trim();
    const ing = Array.isArray(ingredients) ? ingredients : [];
    const normalized = ing
      .map((i) => {
        const qty = Number(i.quantityKg);
        const price = Number(i.pricePerKg);
        const total = qty * price;
        return {
          name: String(i.name || "").trim(),
          quantityKg: qty,
          pricePerKg: price,
          total,
        };
      })
      .filter((i) => i.name);
    const totalExpense = normalized.reduce((s, x) => s + x.total, 0);
    const doc = await Mess.findOneAndUpdate(
      { date: today },
      {
        messName: name,
        ingredients: normalized,
        totalExpense,
        assigned: false,
        presentCountAtAssign: 0,
        costPerHead: 0,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return sendJson(res, 200, true, "Mess saved", { mess: doc });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function assignCost(req, res) {
  try {
    const { date: bodyDate } = req.body || {};
    const today =
      bodyDate && /^\d{4}-\d{2}-\d{2}$/.test(String(bodyDate)) ? String(bodyDate) : localDateStr();
    const mess = await Mess.findOne({ date: today });
    if (!mess) {
      return sendJson(res, 400, false, "No mess data for today. Save mess first.", null);
    }
    const presentCount = await Attendance.countDocuments({ date: today, status: "Present" });
    if (presentCount === 0) {
      return sendJson(res, 400, false, "No present employees to assign cost", null);
    }
    const costPerHead = mess.totalExpense / presentCount;
    mess.costPerHead = Math.round(costPerHead * 100) / 100;
    mess.presentCountAtAssign = presentCount;
    mess.assigned = true;
    await mess.save();
    return sendJson(res, 200, true, "Cost assigned", { mess });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getTodayMess(req, res) {
  try {
    const today = localDateStr();
    const mess = await Mess.findOne({ date: today }).lean();
    return sendJson(res, 200, true, "OK", { mess });
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
    const messes = await Mess.find({
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: -1 })
      .lean();
    const reports = [];
    for (const m of messes) {
      const presentCount = await Attendance.countDocuments({ date: m.date, status: "Present" });
      reports.push({
        date: m.date,
        mess: m.messName || "—",
        totalExpense: m.totalExpense,
        presentCount,
        costPerHead: m.costPerHead,
        ingredients: m.ingredients || [],
      });
    }
    return sendJson(res, 200, true, "OK", { reports });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = {
  getTodayAttendance,
  getEmployees,
  getTodayMess,
  saveMess,
  assignCost,
  getReports,
};
