import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";
import { getStoredRole } from "../utils/authRole";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    const role = getStoredRole();
    if (role === "admin") {
      navigate("/admin", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Avoid sending a stale Bearer token on the login request (shared axios default).
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      const { data } = await api.post("/api/auth/login", { username, password });
      if (data.success && data.data?.token) {
        localStorage.setItem("token", data.data.token);
        if (data.data.user) {
          localStorage.setItem("user", JSON.stringify(data.data.user));
        }
        const role = data.data.user?.role || getStoredRole();
        if (role === "admin") {
          navigate("/admin", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      } else {
        setError("Invalid username or password");
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError("Invalid username or password");
      } else {
        setError(err.response?.data?.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="excel-auth excel-auth--center">
      <div className="excel-card">
        <h1 className="excel-card__title">Login</h1>
        <p className="excel-card__subtitle">Employee &amp; Admin — same page</p>
        <form onSubmit={handleSubmit} className="excel-form">
          <label className="excel-label">
            Username
            <input
              className="excel-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              disabled={adminMode}
            />
          </label>
          <label className="excel-label">
            Password
            <input
              className="excel-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <div className="login-mode-toggle">
            <button
              type="button"
              className="login-mode-btn"
              onClick={() => {
                const next = !adminMode;
                setAdminMode(next);
                setUsername(next ? "admin" : "");
              }}
            >
              {adminMode ? "Login as Employee" : "Login as Admin"}
            </button>
            {adminMode && <p className="login-mode-hint">Username is set to &quot;admin&quot;. Enter your admin password.</p>}
          </div>
          {error && <p className="excel-msg excel-msg--error">{error}</p>}
          <button type="submit" className="excel-btn excel-btn--primary" disabled={loading}>
            {loading ? "Signing in…" : "Login"}
          </button>
        </form>
        <p className="excel-auth__switch">
          Don&apos;t have account? <Link to="/signup">Sign Up</Link>
        </p>
      </div>
    </div>
  );
}
