import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";

function mapSignupError(err) {
  const status = err.response?.status;
  const msg = err.response?.data?.message || "";
  if (status === 409 && /employee id/i.test(msg)) {
    return "Employee ID already exists";
  }
  if (status === 409 || /already taken|duplicate|exists/i.test(msg)) {
    return "Username already exists";
  }
  return msg || err.message || "Could not create account";
}

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem("token")) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      console.log("Sending employeeId:", employeeId);
      const { data } = await api.post("/api/auth/signup", {
        fullName,
        employeeId,
        username,
        password,
      });
      if (data.success) {
        navigate("/login", { replace: true });
      } else {
        setError(data.message || "Could not create account");
      }
    } catch (err) {
      setError(mapSignupError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="excel-auth excel-auth--center">
      <div className="excel-card">
        <h1 className="excel-card__title">Create account</h1>
        <p className="excel-card__subtitle">Employee Attendance System</p>
        <form onSubmit={handleSubmit} className="excel-form">
          <label className="excel-label">
            Full Name
            <input
              className="excel-input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label className="excel-label">
            Employee ID
            <input
              className="excel-input"
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <label className="excel-label">
            Username <span className="excel-hint">(unique)</span>
            <input
              className="excel-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="excel-label">
            Password
            <input
              className="excel-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="excel-label">
            Confirm Password
            <input
              className="excel-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          {error && <p className="excel-msg excel-msg--error">{error}</p>}
          <button type="submit" className="excel-btn excel-btn--primary" disabled={loading}>
            {loading ? "Creating…" : "Create Account"}
          </button>
        </form>
        <p className="excel-auth__switch">
          Already have account? <Link to="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
