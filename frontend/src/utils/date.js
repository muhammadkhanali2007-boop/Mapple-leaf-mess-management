/** YYYY-MM-DD in local timezone (matches backend attendance date) */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Before 11:00 AM local — aligned with server-side lock for same machine */
export function isBeforeElevenAm() {
  return new Date().getHours() < 11;
}

/** ISO date string for N days ago (for filtering) */
export function dateDaysAgo(days) {
  const x = new Date();
  x.setDate(x.getDate() - days);
  return localDateStr(x);
}

export function filterLast30Days(records) {
  const min = dateDaysAgo(30);
  return [...records]
    .filter((r) => r.date >= min)
    .sort((a, b) => b.date.localeCompare(a.date));
}
