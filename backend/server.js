const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

if (!process.env.JWT_SECRET) {
  console.error(
    "[auth] JWT_SECRET is missing from .env — login will return 500 and protected routes will return 401."
  );
}

const express = require("express");
const cors = require("cors");
const { connectDB } = require("./config/db");
const { ensureAdminUser } = require("./bootstrap/ensureAdminUser");
const authRoutes = require("./routes/authRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const adminRoutes = require("./routes/adminRoutes");
const messRoutes = require("./routes/messRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", messRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    data: null,
  });
});

app.use((err, req, res, next) => {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  console.error(`[Error] ${req.method} ${req.originalUrl} — ${err.message}`);
  res.status(status).json({
    success: false,
    message: "Internal server error",
    data: null,
  });
});

const PORT = Number(process.env.PORT) || 5000;

connectDB()
  .then(async () => {
    await ensureAdminUser();
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
