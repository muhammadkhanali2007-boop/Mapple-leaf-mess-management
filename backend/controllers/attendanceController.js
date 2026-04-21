const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

/** Calendar day YYYY-MM-DD in the server's local timezone */
function localCalendarDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Server-local time: before 11:00 AM */
function isBeforeElevenAm() {
  return new Date().getHours() < 11;
}

/** Whether attendance for `dateStr` can still be edited (same local day, before 11:00) */
function canEditAttendanceForDate(dateStr) {
  const today = localCalendarDateString();
  if (dateStr !== today) {
    return { allowed: false, reason: "same_day_only" };
  }
  if (!isBeforeElevenAm()) {
    return { allowed: false, reason: "locked_after_11" };
  }
  return { allowed: true };
}

async function create(req, res) {
  try {
    const { status, date } = req.body;
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
    if (!isBeforeElevenAm()) {
      return sendJson(res, 403, false, "Attendance locked after 11:00 AM", null);
    }
    const row = await Attendance.create({
      userId: req.user._id,
      date: day,
      status,
    });
    return sendJson(res, 201, true, "Attendance recorded", { attendance: row });
  } catch (err) {
    if (err.code === 11000) {
      return sendJson(res, 409, false, "Attendance already exists for this date", null);
    }
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function getMine(req, res) {
  try {
    const list = await Attendance.find({ userId: req.user._id }).sort({ date: -1 }).lean();
    return sendJson(res, 200, true, "Attendance history retrieved", list);
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
    const gate = canEditAttendanceForDate(doc.date);
    if (!gate.allowed) {
      if (gate.reason === "same_day_only") {
        return sendJson(
          res,
          403,
          false,
          "Attendance can only be edited on the same calendar day before 11:00 AM server time.",
          null
        );
      }
      return sendJson(res, 403, false, "Attendance locked after 11:00 AM", null);
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
