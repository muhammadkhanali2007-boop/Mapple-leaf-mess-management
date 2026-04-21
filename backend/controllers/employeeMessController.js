const Mess = require("../models/Mess");
const { localDateStr, dateDaysAgoStr } = require("../utils/dateHelpers");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

/** Today's mess + assigned mess/cost map for last 30 days (for employee UI) */
async function getEmployeeMessBundle(req, res) {
  try {
    const today = localDateStr();
    const minDate = dateDaysAgoStr(30);
    const todayMess = await Mess.findOne({ date: today }).lean();
    const messes = await Mess.find({
      date: { $gte: minDate },
      assigned: true,
    })
      .select("date messName costPerHead totalExpense")
      .lean();
    const byDate = {};
    messes.forEach((m) => {
      byDate[m.date] = {
        messName: m.messName || "—",
        costPerHead: m.costPerHead,
        totalExpense: m.totalExpense,
      };
    });
    return sendJson(res, 200, true, "OK", { today: todayMess, byDate });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = { getEmployeeMessBundle };
