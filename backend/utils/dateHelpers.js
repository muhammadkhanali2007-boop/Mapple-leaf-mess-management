/** YYYY-MM-DD in server local timezone */
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateDaysAgoStr(days) {
  const x = new Date();
  x.setDate(x.getDate() - days);
  return localDateStr(x);
}

module.exports = { localDateStr, dateDaysAgoStr };
