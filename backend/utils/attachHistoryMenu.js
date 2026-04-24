const { normalizeMealType } = require("./mealHelpers");

/**
 * Batches a single Mess.find with $or (one query), attaches `menu` to each row.
 * Safe for empty lists; no aggregation pipeline.
 * @param {import("mongoose").Model} Mess
 * @param {Array<object>} records - attendance rows with `date` and `mealType`
 * @returns {Promise<Array>} shallow copies with `menu` (string, "—" if none)
 */
async function attachMenuToAttendanceRows(Mess, records) {
  if (!Array.isArray(records) || records.length === 0) {
    return records;
  }
  const keys = new Map();
  for (const r of records) {
    const d = r.date;
    if (d == null || d === undefined) continue;
    const mt = normalizeMealType(r.mealType);
    keys.set(`${d}|${mt}`, { date: d, mealType: mt });
  }
  const pairs = Array.from(keys.values());
  const menuByKey = new Map();
  if (pairs.length > 0) {
    const orConds = pairs.map((p) => ({ date: p.date, mealType: p.mealType }));
    const messDocs = await Mess.find({ $or: orConds }).select("date mealType messName").lean();
    for (const m of messDocs) {
      const k = `${m.date}|${normalizeMealType(m.mealType)}`;
      const name = m.messName != null && String(m.messName).trim() ? m.messName : null;
      menuByKey.set(k, name);
    }
  }
  return records.map((r) => {
    const d = r.date;
    if (d == null || d === undefined) {
      return { ...r, menu: "—" };
    }
    const mt = normalizeMealType(r.mealType);
    const k = `${d}|${mt}`;
    const m = menuByKey.get(k);
    const menu = m == null || m === "" ? "—" : m;
    return { ...r, menu };
  });
}

module.exports = { attachMenuToAttendanceRows };
