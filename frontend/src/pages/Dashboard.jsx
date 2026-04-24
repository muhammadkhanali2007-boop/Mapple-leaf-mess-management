import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { filterLast30Days, localDateStr } from "../utils/date";
import {
  groupAttendanceByDate,
  formatHistoryDateHeading,
  formatEmployeeMealLines,
} from "../utils/attendanceHistoryGroup";

function readStoredFullName() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return "";
    const u = JSON.parse(raw);
    return u.fullName || "";
  } catch {
    return "";
  }
}

function mapSubmitError(err) {
  const status = err.response?.status;
  const msg = (err.response?.data?.message || "").toLowerCase();
  if (status === 409 || msg.includes("already exists")) {
    return "Already submitted for this meal";
  }
  if (status === 403 || msg.includes("closed")) {
    return err.response?.data?.message || "Meal attendance is closed";
  }
  return err.response?.data?.message || err.message || "Request failed";
}

function mealTypeOfRow(r) {
  return r.mealType === "dinner" ? "dinner" : "lunch";
}

/** YYYY-MM-DD → e.g. "23 Apr 2026" (matches Admin history Excel) */
function formatShortHistoryDate(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return String(iso);
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const day = Number(parts[2]);
  if (!y || !m || !day) return String(iso);
  return new Date(y, m - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Plain Excel cell from formatEmployeeMealLines; whole-taka amounts as "Rs. 120" */
function excelEmployeeCostString(line) {
  if (line.cost === "Pending") {
    return "Pending";
  }
  if (line.cost === "—") {
    return "—";
  }
  if (line.status === "Absent" || line.cost === "0") {
    return "0";
  }
  const s = String(line.cost);
  const m = s.match(/^Rs\.\s*(\d+)\.00$/);
  if (m) {
    return `Rs. ${m[1]}`;
  }
  return line.cost;
}

/** Cost line for history cards: Pending muted, Rs. amounts emphasized. */
function renderHistoryCostContent(line) {
  if (line.cost === "Pending") {
    return <span className="excel-cell-muted">Pending</span>;
  }
  if (line.cost === "0" || line.status === "Absent") {
    return "0";
  }
  if (line.cost === "—") {
    return "—";
  }
  if (String(line.cost).startsWith("Rs.")) {
    return <span className="att-history-cost-amount">{line.cost}</span>;
  }
  return line.cost;
}

function isLunchTimeLocked() {
  return new Date().getHours() >= 11;
}

function isDinnerTimeLocked() {
  return new Date().getHours() >= 17;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const todayStr = useMemo(() => localDateStr(), []);
  const [fullName, setFullName] = useState(readStoredFullName);
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusLunch, setStatusLunch] = useState("");
  const [statusDinner, setStatusDinner] = useState("");
  const [idLunch, setIdLunch] = useState(null);
  const [idDinner, setIdDinner] = useState(null);
  const [submitErrorLunch, setSubmitErrorLunch] = useState("");
  const [submitErrorDinner, setSubmitErrorDinner] = useState("");
  const [submittingLunch, setSubmittingLunch] = useState(false);
  const [submittingDinner, setSubmittingDinner] = useState(false);
  const [clock, setClock] = useState(0);
  const [messBundle, setMessBundle] = useState({
    todayLunch: null,
    todayDinner: null,
    byDate: {},
  });

  const lunchLocked = isLunchTimeLocked();
  const dinnerLocked = isDinnerTimeLocked();

  useEffect(() => {
    const t = setInterval(() => setClock((c) => c + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const loadMessBundle = useCallback(async () => {
    try {
      const { data } = await api.get("/api/mess/employee-bundle");
      if (data.success && data.data) {
        setMessBundle({
          todayLunch: data.data.todayLunch ?? data.data.today ?? null,
          todayDinner: data.data.todayDinner ?? null,
          byDate: data.data.byDate ?? {},
        });
      }
    } catch {
      /* optional */
    }
  }, []);

  /* Logged-in employee’s attendance only — not admin / not global. */
  const loadHistory = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      const { data } = await api.get("/api/attendance/me");
      if (data.success && Array.isArray(data.data)) {
        setRows(data.data);
      } else {
        setRows([]);
        setLoadError(data.message || "Could not load data");
      }
    } catch (err) {
      setLoadError(err.response?.data?.message || err.message || "Could not load data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadMessBundle();
  }, [loadHistory, loadMessBundle]);

  async function refreshAll() {
    await loadHistory();
    await loadMessBundle();
  }

  useEffect(() => {
    const name = readStoredFullName();
    if (name) setFullName(name);
  }, []);

  useEffect(() => {
    const todayRows = rows.filter((r) => r.date === todayStr);
    const lunchR = todayRows.find((r) => mealTypeOfRow(r) === "lunch");
    const dinnerR = todayRows.find((r) => mealTypeOfRow(r) === "dinner");
    setIdLunch(lunchR?._id ?? null);
    setStatusLunch(lunchR?.status || "");
    setIdDinner(dinnerR?._id ?? null);
    setStatusDinner(dinnerR?.status || "");
  }, [rows, todayStr]);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  }

  async function handleSubmitMeal(e, mealType) {
    e.preventDefault();
    const isDinner = mealType === "dinner";
    const setErr = isDinner ? setSubmitErrorDinner : setSubmitErrorLunch;
    const setSubmit = isDinner ? setSubmittingDinner : setSubmittingLunch;
    const status = isDinner ? statusDinner : statusLunch;
    const todayId = isDinner ? idDinner : idLunch;
    setErr("");
    if (isDinner ? dinnerLocked : lunchLocked) {
      setErr(isDinner ? "Dinner attendance is closed" : "Lunch attendance is closed");
      return;
    }
    if (!status || status === "") {
      setErr("Please select status");
      return;
    }
    setSubmit(true);
    try {
      if (todayId) {
        const { data } = await api.put("/api/attendance", {
          attendanceId: todayId,
          status,
        });
        if (!data.success) {
          setErr(mapSubmitError({ response: { data, status: 400 } }));
          return;
        }
      } else {
        const { data } = await api.post("/api/attendance", {
          status,
          mealType: isDinner ? "dinner" : "lunch",
        });
        if (!data.success) {
          setErr(mapSubmitError({ response: { data, status: 400 } }));
          return;
        }
      }
      await loadHistory();
      await loadMessBundle();
    } catch (err) {
      setErr(mapSubmitError(err));
    } finally {
      setSubmit(false);
    }
  }

  /** Same source as the history list: /api/attendance/me, last 30 calendar days. */
  const attendanceHistory = useMemo(() => filterLast30Days(rows), [rows]);
  const historyGrouped = useMemo(() => groupAttendanceByDate(attendanceHistory), [attendanceHistory]);

  const handleDownloadEmployeeExcel = useCallback(async () => {
    // Export ONLY uses attendance from GET /api/attendance/me (this user). Same rows as the UI.
    const data = attendanceHistory;
    console.log("Excel Data:", data);

    const grouped = groupAttendanceByDate(data);
    if (grouped.length === 0) {
      alert("No attendance to export");
      return;
    }
    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Last 30 days");

      const HEADER_BGS = ["FF4FA3BF", "FF8064A2", "FF9BBB59", "FFC0504D", "FF4F81BD"];
      const TITLES = ["Date", "Meal", "Status", "Menu", "Cost"];
      const headerRow = sheet.getRow(1);
      for (let i = 0; i < 5; i += 1) {
        const c = headerRow.getCell(i + 1);
        c.value = TITLES[i];
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BGS[i] } };
        c.font = { name: "Calibri", size: 20, bold: true, italic: true, color: { argb: "FF000000" } };
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
      headerRow.height = 32;
      sheet.getColumn(1).width = 20;
      sheet.getColumn(2).width = 12;
      sheet.getColumn(3).width = 12;
      sheet.getColumn(4).width = 24;
      sheet.getColumn(5).width = 16;

      const by = messBundle.byDate || {};
      let r = 2;
      for (const g of grouped) {
        const dateStr = formatShortHistoryDate(g.date);
        const lineL = formatEmployeeMealLines(g.lunch, by[`${g.date}_lunch`]);
        const lineD = formatEmployeeMealLines(g.dinner, by[`${g.date}_dinner`]);
        const rowL = sheet.getRow(r);
        rowL.getCell(1).value = dateStr;
        rowL.getCell(2).value = "Lunch";
        rowL.getCell(3).value = lineL.status;
        rowL.getCell(4).value = lineL.menu;
        rowL.getCell(5).value = excelEmployeeCostString(lineL);
        const rowD = sheet.getRow(r + 1);
        rowD.getCell(1).value = null;
        rowD.getCell(2).value = "Dinner";
        rowD.getCell(3).value = lineD.status;
        rowD.getCell(4).value = lineD.menu;
        rowD.getCell(5).value = excelEmployeeCostString(lineD);
        sheet.mergeCells(`A${r}:A${r + 1}`);
        r += 2;
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "attendance_last_30_days.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Employee Excel export error:", e);
      alert("Failed to download Excel");
    }
  }, [attendanceHistory, messBundle.byDate]);

  const todayLunchRow = useMemo(
    () => rows.find((r) => r.date === todayStr && mealTypeOfRow(r) === "lunch"),
    [rows, todayStr]
  );
  const todayDinnerRow = useMemo(
    () => rows.find((r) => r.date === todayStr && mealTypeOfRow(r) === "dinner"),
    [rows, todayStr]
  );

  /** Cost from Attendance only (same source as history after assign) */
  function costFromAttendanceRow(row) {
    if (!row) return "—";
    if (row.cost != null && !Number.isNaN(Number(row.cost))) {
      return `Rs. ${Number(row.cost).toFixed(2)}`;
    }
    if (row.status === "Absent") return "0";
    if (row.status === "Present") return "Pending";
    return "—";
  }

  const messL = messBundle.todayLunch;
  const messD = messBundle.todayDinner;
  const labelL = messL?.messName ? messL.messName : "—";
  const labelD = messD?.messName ? messD.messName : "—";
  const costL = costFromAttendanceRow(todayLunchRow);
  const costD = costFromAttendanceRow(todayDinnerRow);

  void clock;

  return (
    <div className="excel-app">
      <header className="excel-topbar">
        <div className="excel-topbar__left">
          <h1 className="excel-welcome">
            Welcome, <span>{fullName || "Employee"}</span>
          </h1>
        </div>
        <div className="excel-topbar__actions">
          <button type="button" className="excel-btn excel-btn--outline" onClick={refreshAll}>
            Refresh Data
          </button>
          <button type="button" className="excel-btn excel-btn--outline" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <section className="excel-section">
        <h2 className="excel-section__title">Today&apos;s attendance</h2>
        <div className="excel-table-wrap">
          <table className="excel-table">
            <thead>
              <tr>
                <th>Meal</th>
                <th>Full Name</th>
                <th>Date</th>
                <th>Status</th>
                <th>Mess</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Lunch</td>
                <td>{fullName || "—"}</td>
                <td>{todayStr}</td>
                <td>
                  <form
                    onSubmit={(e) => handleSubmitMeal(e, "lunch")}
                    className="excel-inline-form"
                  >
                    <select
                      className="excel-select"
                      value={statusLunch}
                      onChange={(e) => setStatusLunch(e.target.value)}
                      disabled={lunchLocked || submittingLunch}
                    >
                      <option value="">Select…</option>
                      <option value="Present">Present</option>
                      <option value="Absent">Absent</option>
                    </select>
                    <button
                      type="submit"
                      className="excel-btn excel-btn--primary excel-btn--sm"
                      disabled={lunchLocked || submittingLunch}
                    >
                      {submittingLunch ? "…" : "Submit"}
                    </button>
                  </form>
                  {submitErrorLunch && (
                    <p className="excel-msg excel-msg--error excel-msg--inline">{submitErrorLunch}</p>
                  )}
                </td>
                <td>{labelL}</td>
                <td>{costL}</td>
              </tr>
              <tr>
                <td>Dinner</td>
                <td>{fullName || "—"}</td>
                <td>{todayStr}</td>
                <td>
                  <form
                    onSubmit={(e) => handleSubmitMeal(e, "dinner")}
                    className="excel-inline-form"
                  >
                    <select
                      className="excel-select"
                      value={statusDinner}
                      onChange={(e) => setStatusDinner(e.target.value)}
                      disabled={dinnerLocked || submittingDinner}
                    >
                      <option value="">Select…</option>
                      <option value="Present">Present</option>
                      <option value="Absent">Absent</option>
                    </select>
                    <button
                      type="submit"
                      className="excel-btn excel-btn--primary excel-btn--sm"
                      disabled={dinnerLocked || submittingDinner}
                    >
                      {submittingDinner ? "…" : "Submit"}
                    </button>
                  </form>
                  {submitErrorDinner && (
                    <p className="excel-msg excel-msg--error excel-msg--inline">{submitErrorDinner}</p>
                  )}
                </td>
                <td>{labelD}</td>
                <td>{costD}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="excel-note">
          Lunch locks after 11:00; dinner locks after 17:00 (server time). Mess values appear when
          admin assigns cost.
        </p>
      </section>

      <section className="excel-section">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            marginBottom: "0.5rem",
          }}
        >
          <h2 className="excel-section__title" style={{ marginBottom: 0 }}>
            Attendance History (last 30 days)
          </h2>
          <button
            type="button"
            className="excel-btn excel-btn--outline"
            style={{ flexShrink: 0 }}
            onClick={handleDownloadEmployeeExcel}
            disabled={loading || !!loadError || historyGrouped.length === 0}
          >
            Download Excel
          </button>
        </div>
        {loading ? (
          <p className="excel-muted">Loading…</p>
        ) : loadError ? (
          <p className="excel-msg excel-msg--error">{loadError}</p>
        ) : historyGrouped.length === 0 ? (
          <p className="excel-muted" role="status">
            No attendance recorded
          </p>
        ) : (
          <div className="att-history-list att-history-list--employee">
            {historyGrouped.map((g) => (
              <article key={g.date} className="att-history-day att-history-day--card">
                <h3 className="att-history-day__title att-history-title">
                  <span className="att-history-day__icon" aria-hidden>
                    📅
                  </span>
                  {formatHistoryDateHeading(g.date)}
                </h3>
                <div className="att-history-meals">
                  {["lunch", "dinner"].map((meal) => {
                    const row = g[meal];
                    const m = messBundle.byDate[`${g.date}_${meal}`];
                    const line = formatEmployeeMealLines(row, m);
                    const mealLabel = meal === "dinner" ? "🌙 Dinner" : "🍽️ Lunch";
                    const statusNode = row ? (
                      line.status === "Present" ? (
                        <span className="excel-badge excel-badge--present">{line.status}</span>
                      ) : line.status === "Absent" ? (
                        <span className="excel-badge excel-badge--absent">{line.status}</span>
                      ) : (
                        <span className="excel-badge excel-badge--neutral">{line.status}</span>
                      )
                    ) : (
                      <span className="excel-badge excel-badge--neutral">Not marked</span>
                    );
                    return (
                      <div
                        key={meal}
                        className={`att-history-meal att-history-meal--${meal} att-history-meal--block`}
                      >
                        <div className="att-history-meal__name">{mealLabel}</div>
                        <div className="att-history-meal__line">
                          <span className="att-history-meal__label">Status</span> {statusNode}
                        </div>
                        <div className="att-history-meal__line">
                          <span className="att-history-meal__label">Menu</span>{" "}
                          <span className="att-history-meal__value-menu">{line.menu}</span>
                        </div>
                        <div className="att-history-meal__line">
                          <span className="att-history-meal__label">Cost</span>{" "}
                          {renderHistoryCostContent(line)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
