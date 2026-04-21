import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import adminApi from "../services/adminApi";
import { localDateStr } from "../utils/date";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function nowClock() {
  return new Date().toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function lockPhase() {
  const h = new Date().getHours();
  if (h >= 20) return "finalized";
  if (h >= 11) return "locked";
  return "open";
}

export default function AdminDashboard({ hidePanelLogout = false }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("attendance");
  const [clock, setClock] = useState(nowClock);

  const [summary, setSummary] = useState({
    totalEmployees: 0,
    todayPresentCount: 0,
    todayAbsentCount: 0,
    present: [],
    absent: [],
  });
  const [searchName, setSearchName] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadErr, setLoadErr] = useState("");

  const [messName, setMessName] = useState("");
  const [ingredients, setIngredients] = useState([]);
  const [newRow, setNewRow] = useState({ name: "", quantityKg: "", pricePerKg: "" });
  const [editingIdx, setEditingIdx] = useState(null);
  const [messMsg, setMessMsg] = useState("");
  const [messErr, setMessErr] = useState("");
  const [assignErr, setAssignErr] = useState("");

  const [reportStart, setReportStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localDateStr(d);
  });
  const [reportEnd, setReportEnd] = useState(() => localDateStr());
  const [reports, setReports] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [expandedDate, setExpandedDate] = useState(null);

  const phase = lockPhase();

  useEffect(() => {
    const t = setInterval(() => setClock(nowClock()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadAttendance = useCallback(async () => {
    setLoadErr("");
    try {
      const { data } = await adminApi.get("/api/admin/attendance/today");
      if (data.success && data.data) {
        setSummary({
          totalEmployees: data.data.totalEmployees ?? 0,
          todayPresentCount: data.data.todayPresentCount ?? 0,
          todayAbsentCount: data.data.todayAbsentCount ?? 0,
          present: data.data.present || [],
          absent: data.data.absent || [],
        });
      }
    } catch (e) {
      setLoadErr(e.response?.data?.message || "Failed to load attendance");
    }
  }, []);

  const loadTodayMess = useCallback(async () => {
    try {
      const { data } = await adminApi.get("/api/admin/mess/today");
      if (data.success && data.data?.mess) {
        const m = data.data.mess;
        setMessName(m.messName || "");
        setIngredients(
          (m.ingredients || []).map((i, idx) => ({
            ...i,
            _key: i._id || idx,
          }))
        );
      }
    } catch {
      /* empty */
    }
  }, []);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    if (tab === "mess") loadTodayMess();
  }, [tab, loadTodayMess]);

  const filteredPresent = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return summary.present.filter((r) => {
      const ok = !q || r.employeeName.toLowerCase().includes(q);
      if (statusFilter === "absent") return false;
      return ok;
    });
  }, [summary.present, searchName, statusFilter]);

  const filteredAbsent = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return summary.absent.filter((r) => {
      const ok = !q || r.employeeName.toLowerCase().includes(q);
      if (statusFilter === "present") return false;
      return ok;
    });
  }, [summary.absent, searchName, statusFilter]);

  const totalExpense = useMemo(
    () => ingredients.reduce((s, i) => s + (Number(i.total) || 0), 0),
    [ingredients]
  );

  const costPreview =
    summary.todayPresentCount > 0 ? totalExpense / summary.todayPresentCount : null;

  function addIngredient(e) {
    e?.preventDefault();
    const qty = Number(newRow.quantityKg);
    const price = Number(newRow.pricePerKg);
    if (!newRow.name?.trim()) {
      setMessErr("Enter ingredient name");
      return;
    }
    if (Number.isNaN(qty) || qty < 0 || Number.isNaN(price) || price < 0) {
      setMessErr("Enter valid quantity and price");
      return;
    }
    setMessErr("");
    const total = qty * price;
    setIngredients((prev) => [
      ...prev,
      {
        name: newRow.name.trim(),
        quantityKg: qty,
        pricePerKg: price,
        total,
        _key: Date.now() + Math.random(),
      },
    ]);
    setNewRow({ name: "", quantityKg: "", pricePerKg: "" });
  }

  function deleteIngredient(idx) {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  }

  function saveIngredientEdit(idx) {
    setEditingIdx(null);
  }

  async function saveMess() {
    setMessMsg("");
    setMessErr("");
    try {
      const { data } = await adminApi.post("/api/admin/mess", {
        messName,
        menu: messName,
        ingredients: ingredients.map((i) => ({
          name: i.name,
          quantityKg: i.quantityKg,
          pricePerKg: i.pricePerKg,
        })),
        totalExpense,
        costPerPerson: costPreview ?? 0,
      });
      if (data.success) {
        setMessMsg("Menu saved");
        await loadTodayMess();
      } else {
        setMessErr(data.message || "Save failed");
      }
    } catch (e) {
      setMessErr(e.response?.data?.message || "Save failed");
    }
  }

  async function assignCost() {
    setAssignErr("");
    if (phase === "finalized") {
      setAssignErr("Day finalized — no edits allowed");
      return;
    }
    if (summary.todayPresentCount === 0) {
      setAssignErr("No present employees to assign cost");
      return;
    }
    try {
      const { data } = await adminApi.post("/api/admin/mess/assign-cost", {
        costPerPerson: costPreview,
        date: localDateStr(),
      });
      if (data.success) {
        setMessMsg("Cost assigned successfully");
        loadAttendance();
      } else {
        setAssignErr(data.message || "Assign failed");
      }
    } catch (e) {
      setAssignErr(e.response?.data?.message || "Assign failed");
    }
  }

  async function loadReports() {
    setReportLoading(true);
    try {
      const { data } = await adminApi.get("/api/admin/reports", {
        params: { from: reportStart, to: reportEnd },
      });
      if (data.success && data.data?.reports) {
        setReports(data.data.reports);
      } else {
        setReports([]);
      }
    } catch {
      setReports([]);
    } finally {
      setReportLoading(false);
    }
  }

  function exportCsv() {
    const headers = ["Date", "Menu", "Total Expense", "Present Count", "Cost per Head"];
    const lines = [headers.join(",")];
    reports.forEach((r) => {
      lines.push(
        [r.date, `"${String(r.mess).replace(/"/g, '""')}"`, r.totalExpense, r.presentCount, r.costPerHead].join(
          ","
        )
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mess-report-${reportStart}-${reportEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXlsx() {
    const rows = reports.map((r) => ({
      Date: r.date,
      Menu: r.mess,
      "Total Expense": r.totalExpense,
      "Present Count": r.presentCount,
      "Cost per Head": r.costPerHead,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `mess-report-${reportStart}-${reportEnd}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Mess Management Report", 14, 12);
    doc.setFontSize(10);
    doc.text(`Range: ${reportStart} to ${reportEnd}`, 14, 18);
    autoTable(doc, {
      startY: 22,
      head: [["Date", "Menu", "Total Expense", "Present", "Cost / Head"]],
      body: reports.map((r) => [
        r.date,
        r.mess,
        String(r.totalExpense),
        String(r.presentCount),
        String(r.costPerHead),
      ]),
    });
    doc.save(`mess-report-${reportStart}-${reportEnd}.pdf`);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  }

  const messDisabled = phase === "finalized";

  return (
    <div className="admin-app">
      <header className="admin-nav-bar">
        <div className="admin-nav-bar__brand">
          <h1 className="admin-brand">Mess Management — Admin Panel</h1>
        </div>
        <nav className="admin-nav-bar__tabs" aria-label="Admin sections">
          <button
            type="button"
            className={tab === "attendance" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("attendance")}
          >
            Attendance
          </button>
          <button
            type="button"
            className={tab === "mess" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("mess")}
          >
            Mess Management
          </button>
          <button
            type="button"
            className={tab === "reports" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("reports")}
          >
            Reports
          </button>
        </nav>
        <div className="admin-nav-bar__right">
          <span className="admin-clock-inline">{clock}</span>
          {!hidePanelLogout && (
            <button type="button" className="excel-btn excel-btn--outline" onClick={logout}>
              Logout
            </button>
          )}
        </div>
      </header>

      {phase === "locked" && (
        <div className="admin-banner admin-banner--yellow">
          ⚠️ Attendance Locked — 11:00 AM passed
        </div>
      )}
      {phase === "finalized" && (
        <div className="admin-banner admin-banner--red">
          🔒 Day Finalized — No edits allowed
        </div>
      )}

      {tab === "attendance" && (
        <>
          <div className="admin-summary">
            <div className="admin-card admin-card--gray">
              <div className="admin-card__label">Total Employees</div>
              <div className="admin-card__value">{summary.totalEmployees}</div>
            </div>
            <div className="admin-card admin-card--green">
              <div className="admin-card__label">Today Present</div>
              <div className="admin-card__value">{summary.todayPresentCount}</div>
            </div>
            <div className="admin-card admin-card--red">
              <div className="admin-card__label">Today Absent</div>
              <div className="admin-card__value">{summary.todayAbsentCount}</div>
            </div>
          </div>

          <div className="admin-filters">
            <label className="admin-filter-item">
              Search by name
              <input
                className="excel-input"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="Search by name…"
              />
            </label>
            <label className="admin-filter-item">
              Status
              <select
                className="excel-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </select>
            </label>
            <button type="button" className="excel-btn excel-btn--outline" onClick={loadAttendance}>
              Refresh Data
            </button>
          </div>
          {loadErr && <p className="excel-msg excel-msg--error">{loadErr}</p>}

          <div className="admin-split">
            <div>
              <h2 className="admin-section-title">Present List</h2>
              <div className="excel-table-wrap">
                <table className="excel-table excel-table--present">
                  <thead>
                    <tr className="excel-thead-green">
                      <th>Employee Name</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPresent.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="excel-cell-muted">
                          No records
                        </td>
                      </tr>
                    ) : (
                      filteredPresent.map((r, i) => (
                        <tr key={`p-${i}`}>
                          <td>{r.employeeName}</td>
                          <td>{r.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h2 className="admin-section-title">Absent List</h2>
              <div className="excel-table-wrap">
                <table className="excel-table excel-table--absent">
                  <thead>
                    <tr className="excel-thead-red">
                      <th>Employee Name</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAbsent.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="excel-cell-muted">
                          No records
                        </td>
                      </tr>
                    ) : (
                      filteredAbsent.map((r, i) => (
                        <tr key={`a-${i}`}>
                          <td>{r.employeeName}</td>
                          <td>{r.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "mess" && (
        <div className="admin-mess">
          <h2 className="admin-section-title">Step 1 — Today&apos;s Menu</h2>
          <label className="excel-label admin-menu-label">Today&apos;s Menu</label>
          <div className="admin-mess-row">
            <input
              className="excel-input admin-mess-input"
              placeholder="e.g. Mutton + Rice"
              value={messName}
              onChange={(e) => setMessName(e.target.value)}
              disabled={messDisabled}
            />
            <button type="button" className="excel-btn excel-btn--primary excel-btn--lg" onClick={saveMess} disabled={messDisabled}>
              Save Menu
            </button>
          </div>

          <h2 className="admin-section-title">Step 2 — Ingredients</h2>
          <form className="admin-ing-add" onSubmit={addIngredient}>
            <input
              className="excel-input"
              placeholder="Ingredient Name"
              value={newRow.name}
              onChange={(e) => setNewRow((x) => ({ ...x, name: e.target.value }))}
              disabled={messDisabled}
            />
            <input
              className="excel-input"
              placeholder="Quantity (KG)"
              type="number"
              step="0.01"
              min="0"
              value={newRow.quantityKg}
              onChange={(e) => setNewRow((x) => ({ ...x, quantityKg: e.target.value }))}
              disabled={messDisabled}
            />
            <input
              className="excel-input"
              placeholder="Price per KG"
              type="number"
              step="0.01"
              min="0"
              value={newRow.pricePerKg}
              onChange={(e) => setNewRow((x) => ({ ...x, pricePerKg: e.target.value }))}
              disabled={messDisabled}
            />
            <button type="submit" className="excel-btn excel-btn--primary" disabled={messDisabled}>
              Add
            </button>
          </form>
          {messErr && <p className="excel-msg excel-msg--error">{messErr}</p>}
          {messMsg && <p className="excel-msg excel-msg--ok">{messMsg}</p>}

          <div className="excel-table-wrap">
            <table className="excel-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Qty (KG)</th>
                  <th>Price/KG</th>
                  <th>Total (Rs.)</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {ingredients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="excel-cell-muted">
                      No ingredients yet
                    </td>
                  </tr>
                ) : (
                  ingredients.map((row, idx) => (
                    <tr key={row._key || idx}>
                      {editingIdx === idx ? (
                        <>
                          <td>{idx + 1}</td>
                          <td>
                            <input
                              className="excel-input"
                              value={row.name}
                              onChange={(e) => {
                                const v = e.target.value;
                                setIngredients((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, name: v } : p))
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="excel-input"
                              type="number"
                              value={row.quantityKg}
                              onChange={(e) => {
                                const qty = Number(e.target.value);
                                setIngredients((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    const total = qty * p.pricePerKg;
                                    return { ...p, quantityKg: qty, total };
                                  })
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="excel-input"
                              type="number"
                              value={row.pricePerKg}
                              onChange={(e) => {
                                const price = Number(e.target.value);
                                setIngredients((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    const total = p.quantityKg * price;
                                    return { ...p, pricePerKg: price, total };
                                  })
                                );
                              }}
                            />
                          </td>
                          <td>{(row.quantityKg * row.pricePerKg).toFixed(2)}</td>
                          <td>
                            <button type="button" className="excel-btn excel-btn--sm" onClick={() => saveIngredientEdit(idx)}>
                              Done
                            </button>
                          </td>
                          <td>
                            <button type="button" className="excel-btn excel-btn--sm" onClick={() => deleteIngredient(idx)}>
                              Delete
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{idx + 1}</td>
                          <td>{row.name}</td>
                          <td>{row.quantityKg}</td>
                          <td>{row.pricePerKg}</td>
                          <td>{Number(row.total).toFixed(2)}</td>
                          <td>
                            <button
                              type="button"
                              className="excel-btn excel-btn--sm"
                              onClick={() => setEditingIdx(idx)}
                              disabled={messDisabled}
                            >
                              Edit
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="excel-btn excel-btn--sm"
                              onClick={() => deleteIngredient(idx)}
                              disabled={messDisabled}
                            >
                              Delete
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {ingredients.length > 0 && (
                <tfoot>
                  <tr className="admin-ing-total">
                    <td colSpan={4} className="admin-ing-total-label">
                      <strong>Total Expense</strong>
                    </td>
                    <td colSpan={3}>
                      <strong>Rs. {totalExpense.toFixed(2)}</strong>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <h2 className="admin-section-title">Step 3 — Cost division</h2>
          <div className="admin-cost-boxes">
            <div className="admin-cost-box">
              <div className="admin-cost-box__label">Present Employees Today</div>
              <div className="admin-cost-box__value">{summary.todayPresentCount}</div>
            </div>
            <div className="admin-cost-box">
              <div className="admin-cost-box__label">Cost per Person</div>
              <div className="admin-cost-box__value">
                {costPreview != null && summary.todayPresentCount > 0
                  ? `Rs. ${costPreview.toFixed(2)}`
                  : "—"}
              </div>
            </div>
          </div>
          {summary.todayPresentCount === 0 && (
            <p className="excel-msg excel-msg--error">No present employees to assign cost</p>
          )}

          <h2 className="admin-section-title">Step 4 — Assign cost</h2>
          <button
            type="button"
            className="excel-btn excel-btn--primary excel-btn--assign"
            onClick={assignCost}
            disabled={messDisabled || totalExpense <= 0}
          >
            Assign Cost to Present Employees
          </button>
          {assignErr && <p className="excel-msg excel-msg--error">{assignErr}</p>}
        </div>
      )}

      {tab === "reports" && (
        <div className="admin-reports">
          <div className="admin-filters admin-filters--reports">
            <label>
              From:
              <input
                type="date"
                className="excel-input"
                value={reportStart}
                onChange={(e) => setReportStart(e.target.value)}
              />
            </label>
            <label>
              To:
              <input type="date" className="excel-input" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} />
            </label>
            <button type="button" className="excel-btn excel-btn--primary" onClick={loadReports} disabled={reportLoading}>
              {reportLoading ? "Loading…" : "Apply Filter"}
            </button>
          </div>
          <div className="admin-export">
            <button type="button" className="excel-btn excel-btn--outline" onClick={exportCsv} disabled={!reports.length}>
              Export CSV
            </button>
            <button type="button" className="excel-btn excel-btn--outline" onClick={exportXlsx} disabled={!reports.length}>
              Export Excel (.xlsx)
            </button>
            <button type="button" className="excel-btn excel-btn--outline" onClick={exportPdf} disabled={!reports.length}>
              Export PDF
            </button>
          </div>
          <div className="excel-table-wrap">
            <table className="excel-table">
              <thead>
                <tr>
                  <th />
                  <th>Date</th>
                  <th>Menu</th>
                  <th>Total Expense</th>
                  <th>Present Count</th>
                  <th>Cost per Head</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="excel-cell-muted">
                      No data — set dates and Apply
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => (
                    <Fragment key={r.date}>
                      <tr className="admin-report-row">
                        <td>
                          <button
                            type="button"
                            className="excel-btn excel-btn--sm"
                            onClick={() => setExpandedDate((x) => (x === r.date ? null : r.date))}
                          >
                            {expandedDate === r.date ? "−" : "+"}
                          </button>
                        </td>
                        <td>{r.date}</td>
                        <td>{r.mess}</td>
                        <td>{r.totalExpense}</td>
                        <td>{r.presentCount}</td>
                        <td>{r.costPerHead}</td>
                      </tr>
                      {expandedDate === r.date && (
                        <tr className="admin-report-detail">
                          <td colSpan={6}>
                            <div className="excel-table-wrap">
                              <table className="excel-table">
                                <thead>
                                  <tr>
                                    <th>Name</th>
                                    <th>Qty (KG)</th>
                                    <th>Price/KG</th>
                                    <th>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(r.ingredients || []).length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="excel-cell-muted">
                                        No ingredient rows
                                      </td>
                                    </tr>
                                  ) : (
                                    r.ingredients.map((ing, j) => (
                                      <tr key={j}>
                                        <td>{ing.name}</td>
                                        <td>{ing.quantityKg}</td>
                                        <td>{ing.pricePerKg}</td>
                                        <td>{ing.total}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
