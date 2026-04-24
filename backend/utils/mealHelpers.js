/** Lunch/dinner model helpers — server uses local time like existing app */

const LUNCH = "lunch";
const DINNER = "dinner";

/**
 * Coerce to "lunch" | "dinner". Case/whitespace safe — required so dinner
 * is not mis-handled as lunch (which would false-positive duplicate lunch).
 */
function normalizeMealType(m) {
  if (m == null) return LUNCH;
  const s = String(m).trim().toLowerCase();
  if (s === DINNER) return DINNER;
  return LUNCH;
}

/** After bootstrap all docs have mealType; this matches legacy "lunch" if any left */
function filterForMealType(mealType) {
  const m = normalizeMealType(mealType);
  if (m === DINNER) {
    return { mealType: DINNER };
  }
  return { $or: [{ mealType: LUNCH }, { mealType: { $exists: false } }] };
}

function finalizedCostMessage(mealType) {
  const m = normalizeMealType(mealType);
  if (m === DINNER) return "Today's dinner cost already finalized";
  return "Today's lunch cost already finalized";
}

/** 11:00 and later = lunch closed. 17:00 and later = dinner closed. */
function isLunchTimeLocked() {
  if (process.env.ATTENDANCE_RELAX_TIME === "true") return false;
  const d = new Date();
  return d.getHours() >= 11;
}

function isDinnerTimeLocked() {
  if (process.env.ATTENDANCE_RELAX_TIME === "true") return false;
  const d = new Date();
  return d.getHours() >= 17;
}

function isMealTimeLocked(mealType) {
  const m = normalizeMealType(mealType);
  if (m === DINNER) return isDinnerTimeLocked();
  return isLunchTimeLocked();
}

module.exports = {
  LUNCH,
  DINNER,
  normalizeMealType,
  filterForMealType,
  finalizedCostMessage,
  isLunchTimeLocked,
  isDinnerTimeLocked,
  isMealTimeLocked,
};
