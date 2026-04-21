import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { filterLast30Days, isBeforeElevenAm, localDateStr } from "../utils/date";

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
    return "Already submitted today";
  }
  if (status === 403 || msg.includes("locked")) {
    return "Attendance time is over";
  }
  return err.response?.data?.message || err.message || "Request failed";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const todayStr = useMemo(() => localDateStr(), []);
  const [fullName, setFullName] = useState(readStoredFullName);
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [todayId, setTodayId] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [messBundle, setMessBundle] = useState({ today: null, byDate: {} });

  const locked = !isBeforeElevenAm();

  const loadMessBundle = useCallback(async () => {
    try {
      const { data } = await api.get("/api/mess/employee-bundle");
      if (data.success && data.data) {
        setMessBundle({
          today: data.data.today ?? null,
          byDate: data.data.byDate ?? {},
        });
      }
    } catch {
      /* optional: mess API unavailable */
    }
  }, []);

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
    const t = rows.find((r) => r.date === todayStr);
    if (t) {
      setTodayId(t._id);
      setStatus(t.status || "");
    } else {
      setTodayId(null);
      setStatus("");
    }
  }, [rows, todayStr]);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    if (locked) {
      setSubmitError("Attendance time is over");
      return;
    }
    if (!status || status === "") {
      setSubmitError("Please select status");
      return;
    }
    setSubmitting(true);
    try {
      if (todayId) {
        const { data } = await api.put("/api/attendance", {
          attendanceId: todayId,
          status,
        });
        if (!data.success) {
          setSubmitError(mapSubmitError({ response: { data, status: 400 } }));
          return;
        }
      } else {
        const { data } = await api.post("/api/attendance", { status });
        if (!data.success) {
          setSubmitError(mapSubmitError({ response: { data, status: 400 } }));
          return;
        }
      }
      await loadHistory();
      await loadMessBundle();
    } catch (err) {
      setSubmitError(mapSubmitError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const history30 = useMemo(() => filterLast30Days(rows), [rows]);

  const todayMess = messBundle.today;
  const todayMessLabel = todayMess?.messName ? todayMess.messName : "—";
  const todayCostLabel =
    todayMess?.assigned && todayMess.costPerHead != null
      ? `Rs. ${Number(todayMess.costPerHead).toFixed(2)}`
      : "—";

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

      {locked && (
        <div className="excel-lock-banner" role="alert">
          Attendance Locked
        </div>
      )}

      <section className="excel-section">
        <h2 className="excel-section__title">Today&apos;s attendance</h2>
        <div className="excel-table-wrap">
          <table className="excel-table">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Date</th>
                <th>Status</th>
                <th>Today&apos;s Mess</th>
                <th>Cost per Day</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{fullName || "—"}</td>
                <td>{todayStr}</td>
                <td>
                  <form onSubmit={handleSubmit} className="excel-inline-form">
                    <select
                      className="excel-select"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      disabled={locked || submitting}
                    >
                      <option value="">Select status…</option>
                      <option value="Present">Present</option>
                      <option value="Absent">Absent</option>
                    </select>
                    <button
                      type="submit"
                      className="excel-btn excel-btn--primary excel-btn--sm"
                      disabled={locked || submitting}
                    >
                      {submitting ? "…" : "Submit"}
                    </button>
                  </form>
                  {submitError && <p className="excel-msg excel-msg--error excel-msg--inline">{submitError}</p>}
                </td>
                <td>{todayMessLabel}</td>
                <td>{todayCostLabel}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="excel-note">
          Mess details are managed by admin. Values appear here when available.
        </p>
      </section>

      <section className="excel-section">
        <h2 className="excel-section__title">Attendance History (last 30 days)</h2>
        {loading ? (
          <p className="excel-muted">Loading…</p>
        ) : loadError ? (
          <p className="excel-msg excel-msg--error">{loadError}</p>
        ) : history30.length === 0 ? (
          <p className="excel-muted">No records yet</p>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Mess</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {history30.map((row) => {
                  const m = messBundle.byDate[row.date];
                  return (
                    <tr key={row._id}>
                      <td>{row.date}</td>
                      <td>
                        <span
                          className={
                            row.status === "Present"
                              ? "excel-badge excel-badge--present"
                              : "excel-badge excel-badge--absent"
                          }
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>{m?.messName ?? "—"}</td>
                      <td>
                        {m?.costPerHead != null ? `Rs. ${Number(m.costPerHead).toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
