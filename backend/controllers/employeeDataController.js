const mongoose = require("mongoose");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const Mess = require("../models/Mess");
const { localDateStr, dateDaysAgoStr } = require("../utils/dateHelpers");
const { attachMenuToAttendanceRows } = require("../utils/attachHistoryMenu");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

function last30DayRange() {
  const today = localDateStr();
  const fromDate = dateDaysAgoStr(29);
  return { today, fromDate };
}

/** Master list: employees with 30-day attendance count (User = single source of truth). */
async function listEmployeeData(req, res) {
  try {
    console.log("EMPLOYEE DATA API HIT");
    const { today, fromDate } = last30DayRange();
    const users = await User.find({ role: "employee" })
      .select("fullName employeeId username createdAt")
      .sort({ username: 1 })
      .lean();

    const rows = [];
    for (const u of users) {
      const id = String(u._id);
      const totalAttendance30Days = await Attendance.countDocuments({
        userId: u._id,
        date: { $gte: fromDate, $lte: today },
      });
      rows.push({
        id,
        employeeId: u.employeeId || "",
        name: u.fullName,
        username: u.username,
        createdAt: u.createdAt,
        totalAttendance30Days,
      });
      console.log("Sending employeeId:", u.employeeId || "");
    }

    return sendJson(res, 200, true, "OK", { employees: rows });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

/** 30-day attendance; cost is read from Attendance (permanent, set on assign). Sorted by date DESC. */
async function getEmployeeHistoryAdmin(req, res) {
  try {
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return sendJson(res, 400, false, "Invalid employee id", null);
    }
    const emp = await User.findOne({ _id: employeeId, role: "employee" }).lean();
    if (!emp) {
      return sendJson(res, 404, false, "Employee not found", null);
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
    const withMenu = await attachMenuToAttendanceRows(Mess, records);
    const rows = withMenu.map((r) => ({
      date: r.date,
      status: r.status,
      mealType: r.mealType != null ? r.mealType : "lunch",
      cost:
        r.cost == null || r.cost === "" || Number.isNaN(Number(r.cost))
          ? null
          : Number(r.cost),
      menu: r.menu,
    }));

    return sendJson(res, 200, true, "OK", { records: rows });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function updateEmployeeData(req, res) {
  try {
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return sendJson(res, 400, false, "Invalid employee id", null);
    }
    const { name, username } = req.body || {};
    const fullName = name != null ? String(name).trim() : "";
    const uname = username != null ? String(username).toLowerCase().trim() : "";

    if (!fullName || !uname) {
      return sendJson(res, 400, false, "name and username are required", null);
    }

    const user = await User.findOne({ _id: employeeId, role: "employee" });
    if (!user) {
      return sendJson(res, 404, false, "Employee not found", null);
    }

    const taken = await User.findOne({
      username: uname,
      _id: { $ne: employeeId },
    });
    if (taken) {
      return sendJson(res, 409, false, "Username already taken", null);
    }

    user.fullName = fullName;
    user.username = uname;
    await user.save();

    return sendJson(res, 200, true, "Employee updated", {
      employee: {
        id: String(user._id),
        employeeId: user.employeeId || "",
        name: user.fullName,
        username: user.username,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return sendJson(res, 409, false, "Username already taken", null);
    }
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function deleteEmployeeData(req, res) {
  try {
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return sendJson(res, 400, false, "Invalid employee id", null);
    }

    const user = await User.findOne({ _id: employeeId, role: "employee" });
    if (!user) {
      return sendJson(res, 404, false, "Employee not found", null);
    }

    await Attendance.deleteMany({ userId: employeeId });
    await User.deleteOne({ _id: employeeId, role: "employee" });

    return sendJson(res, 200, true, "Employee deleted", null);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = {
  listEmployeeData,
  getEmployeeHistoryAdmin,
  updateEmployeeData,
  deleteEmployeeData,
};
