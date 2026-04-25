const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Mess = require("../models/Mess");
const { attachMenuToAttendanceRows } = require("../utils/attachHistoryMenu");
const {
  normalizeMealType,
  isMealTimeLocked,
} = require("../utils/mealHelpers");

if (process.env.ATTENDANCE_RELAX_TIME === "true") {
  console.log("🚧 ATTENDANCE_RELAX_TIME — meal time locks disabled");
}

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

function localCalendarDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isIsoDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function existingLunchQuery(userId, day) {
  return {
    userId,
    date: day,
    $or: [{ mealType: "lunch" }, { mealType: { $exists: false } }],
  };
}

function existingDinnerQuery(userId, day) {
  return { userId, date: day, mealType: "dinner" };
}

async function findExistingForMeal(userId, day, mealType) {
  const m = normalizeMealType(mealType);
  if (m === "dinner") {
    return Attendance.findOne(existingDinnerQuery(userId, day));
  }
  return Attendance.findOne(existingLunchQuery(userId, day));
}

async function create(req, res) {
  try {
    const { status, date, mealType: bodyMeal } = req.body;
    const mealType = normalizeMealType(bodyMeal);
    const day = date ? String(date).trim() : localCalendarDateString();
    if (!["Present", "Absent"].includes(status)) {
      return sendJson(res, 400, false, "status must be Present or Absent", null);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return sendJson(res, 400, false, "date must be YYYY-MM-DD", null);
    }
    const today = localCalendarDateString();
    if (day !== today) {
      return sendJson(res, 400, false, "You can only record attendance for today", null);
    }
    if (isMealTimeLocked(mealType)) {
      const msg =
        mealType === "dinner" ? "Dinner attendance is closed" : "Lunch attendance is closed";
      return sendJson(res, 403, false, msg, null);
    }

    const exist = await findExistingForMeal(req.user._id, day, mealType);
    if (exist) {
      return sendJson(res, 409, false, "Attendance already exists for this date and meal", null);
    }

    const row = await Attendance.create({
      userId: req.user._id,
      date: day,
      status,
      mealType,
    });
    return sendJson(res, 201, true, "Attendance recorded", { attendance: row });
  } catch (err) {
    if (err.code === 11000) {
      return sendJson(res, 409, false, "Attendance already exists for this date and meal", null);
    }
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getMine(req, res) {
  try {
    const startDate = req.query.startDate || req.query.from;
    const endDate = req.query.endDate || req.query.to;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 50));

    if (!startDate && !endDate) {
      return sendJson(res, 200, true, "Attendance history retrieved", []);
    }
    if (!startDate || !endDate) {
      return sendJson(res, 400, false, "Start date and end date are required", null);
    }
    if ((startDate && !isIsoDateString(startDate)) || (endDate && !isIsoDateString(endDate))) {
      return sendJson(res, 400, false, "Dates must be YYYY-MM-DD", null);
    }
    if (startDate && endDate && String(endDate) < String(startDate)) {
      return sendJson(res, 400, false, "End date cannot be before start date", null);
    }

    const query = { userId: req.user._id };
    query.date = { $gte: String(startDate), $lte: String(endDate) };

    const list = await Attendance.find(query)
      .sort({ date: -1, mealType: 1 })
      .limit(limit)
      .lean();
    const withMenu = await attachMenuToAttendanceRows(Mess, list);
    const payload = withMenu.map((r) => {
      const c = r.cost;
      const cost =
        c == null || c === "" || Number.isNaN(Number(c)) ? null : Number(c);
      return { ...r, cost };
    });
    return sendJson(res, 200, true, "Attendance history retrieved", payload);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function update(req, res) {
  try {
    const { attendanceId, status } = req.body;
    if (!attendanceId || !["Present", "Absent"].includes(status)) {
      return sendJson(res, 400, false, "attendanceId and valid status (Present/Absent) are required", null);
    }
    if (!mongoose.isValidObjectId(attendanceId)) {
      return sendJson(res, 400, false, "Invalid attendanceId", null);
    }
    const doc = await Attendance.findOne({ _id: attendanceId, userId: req.user._id });
    if (!doc) {
      return sendJson(res, 404, false, "Attendance not found", null);
    }
    const day = localCalendarDateString();
    if (doc.date !== day) {
      return sendJson(
        res,
        403,
        false,
        "You can only edit today's attendance for the current calendar day.",
        null
      );
    }
    const mealType = normalizeMealType(doc.mealType);
    if (isMealTimeLocked(mealType)) {
      const msg = mealType === "dinner" ? "Dinner attendance is closed" : "Lunch attendance is closed";
      return sendJson(res, 403, false, msg, null);
    }
    doc.status = status;
    await doc.save();
    return sendJson(res, 200, true, "Attendance updated", { attendance: doc });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = { create, getMine, update };
