const Mess = require("../models/Mess");
const { localDateStr, dateDaysAgoStr } = require("../utils/dateHelpers");
const { normalizeMealType, LUNCH, DINNER } = require("../utils/mealHelpers");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

function messBundleOne(m) {
  if (!m) return null;
  return {
    messName: m.messName || "—",
    costPerHead: m.costPerHead,
    totalCost: m.totalCost ?? m.totalExpense,
    totalExpense: m.totalCost ?? m.totalExpense,
    mealType: m.mealType != null ? m.mealType : LUNCH,
    assigned: m.assigned,
    isFinalized: m.isFinalized,
  };
}

/** Today's lunch/dinner mess + byDate map keyed by "date_meal" for 30d */
async function getEmployeeMessBundle(req, res) {
  try {
    const today = localDateStr();
    const minDate = dateDaysAgoStr(30);
    const [todayLunch, todayDinner] = await Promise.all([
      Mess.findOne({ date: today, mealType: LUNCH }).lean(),
      Mess.findOne({ date: today, mealType: DINNER }).lean(),
    ]);
    const messes = await Mess.find({
      date: { $gte: minDate },
      assigned: true,
    })
      .select("date messName costPerHead totalCost totalExpense mealType")
      .lean();
    const byDate = {};
    messes.forEach((m) => {
      const mt = m.mealType != null ? m.mealType : LUNCH;
      const key = `${m.date}_${mt}`;
      byDate[key] = {
        messName: m.messName || "—",
        costPerHead: m.costPerHead,
        totalCost: m.totalCost ?? m.totalExpense,
        totalExpense: m.totalCost ?? m.totalExpense,
        mealType: mt,
      };
    });
    return sendJson(res, 200, true, "OK", {
      today: todayLunch,
      todayLunch: messBundleOne(todayLunch),
      todayDinner: messBundleOne(todayDinner),
      byDate,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = { getEmployeeMessBundle };
