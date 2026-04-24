/**
 * Group flat attendance records into one object per date with lunch/dinner slots.
 * Frontend-only; does not change API contracts.
 */
export function groupAttendanceByDate(records) {
  const map = new Map();
  for (const r of records || []) {
    const d = r?.date;
    if (!d) continue;
    if (!map.has(d)) {
      map.set(d, { date: d, lunch: null, dinner: null });
    }
    const g = map.get(d);
    const mt = r.mealType === "dinner" ? "dinner" : "lunch";
    g[mt] = r;
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

/** e.g. "23 May 2026" for YYYY-MM-DD (local calendar) */
export function formatHistoryDateHeading(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const day = Number(parts[2]);
  if (!y || !m || !day) return iso;
  const dt = new Date(y, m - 1, day);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const PENDING_LABEL = "Pending";

function menuFromApiOrDash(row) {
  if (row?.menu != null && String(row.menu).trim() && row.menu !== "—") {
    return row.menu;
  }
  return "—";
}

/**
 * Admin / employee-data history: menu from API (Mess) when available; cost from row.
 */
export function formatAdminMealLines(row) {
  if (!row) {
    return { status: "Not marked", menu: "—", cost: "—" };
  }
  const menu = menuFromApiOrDash(row);
  if (row.status === "Absent") {
    return { status: "Absent", menu, cost: "0" };
  }
  if (row.cost != null && row.cost !== "" && !Number.isNaN(Number(row.cost))) {
    return { status: row.status, menu, cost: `Rs. ${Number(row.cost).toFixed(2)}` };
  }
  if (row.status === "Present") {
    return { status: "Present", menu, cost: PENDING_LABEL };
  }
  return { status: row.status, menu, cost: "—" };
}

function resolveEmployeeMenu(row, mess) {
  if (row?.menu != null && String(row.menu).trim() && row.menu !== "—") {
    return row.menu;
  }
  if (mess?.messName && String(mess.messName).trim() && mess.messName !== "—") {
    return mess.messName;
  }
  return "—";
}

/**
 * Employee: cost from Attendance `row.cost` only (single source of truth; not Mess).
 */
export function formatEmployeeMealLines(row, mess) {
  if (!row) {
    return { status: "Not marked", menu: "—", cost: "—" };
  }
  const menu = resolveEmployeeMenu(row, mess);
  if (row.status === "Absent") {
    return { status: "Absent", menu, cost: "0" };
  }
  if (row.cost != null && !Number.isNaN(Number(row.cost))) {
    return { status: row.status, menu, cost: `Rs. ${Number(row.cost).toFixed(2)}` };
  }
  if (row.status === "Present") {
    return { status: "Present", menu, cost: PENDING_LABEL };
  }
  return { status: row.status, menu, cost: "—" };
}
