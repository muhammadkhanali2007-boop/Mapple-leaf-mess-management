const bcrypt = require("bcrypt");
const User = require("../models/User");

/**
 * Ensures exactly one admin user (username: admin, role: admin) exists.
 * Password: process.env.ADMIN_PASSWORD || "Qaidi804" (bcrypt, salt rounds 12).
 * Never overwrites an existing admin.
 */
async function ensureAdminUser() {
  console.log("🔄 Checking admin user...");
  try {
    const existing = await User.findOne({ username: "admin", role: "admin" });
    if (existing) {
      console.log("✅ Admin already exists");
      return;
    }

    const usernameConflict = await User.findOne({ username: "admin" });
    if (usernameConflict) {
      console.log(
        `⚠️ Username "admin" already exists (role: "${usernameConflict.role}") — skipping auto-create. Admin login uses the password stored for that user, not ADMIN_PASSWORD.`
      );
      return;
    }

    const plain = process.env.ADMIN_PASSWORD || "Qaidi804";
    const hashed = await bcrypt.hash(plain, 12);

    await User.create({
      fullName: "Administrator",
      username: "admin",
      password: hashed,
      role: "admin",
    });

    console.log("🆕 Admin user created");
  } catch (err) {
    console.error("❌ ensureAdminUser failed:", err.message);
  }
}

module.exports = { ensureAdminUser };
