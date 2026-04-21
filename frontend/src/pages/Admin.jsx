import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AdminDashboard from "./AdminDashboard";

function readUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export default function Admin() {
  const navigate = useNavigate();
  const user = useMemo(readUser, []);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  }

  return (
    <div className="admin-page-root">
      <section className="admin-page-intro">
        <h1 className="admin-page-intro__title">Admin Dashboard</h1>
        <p className="admin-page-intro__meta">
          <span className="admin-page-intro__name">{user?.fullName || user?.username || "—"}</span>
          <span className="admin-page-intro__sep"> · </span>
          <span>Role: {user?.role ?? "—"}</span>
        </p>
        <button type="button" className="excel-btn excel-btn--outline admin-page-intro__logout" onClick={logout}>
          Logout
        </button>
      </section>
      <AdminDashboard hidePanelLogout />
    </div>
  );
}
