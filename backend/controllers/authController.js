const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(
    { userId: user._id.toString(), username: user.username, role: user.role },
    secret,
    { expiresIn }
  );
}

async function signup(req, res) {
  try {
    const { fullName, username, password } = req.body;
    if (!fullName || !username || !password) {
      return sendJson(res, 400, false, "fullName, username, and password are required", null);
    }
    const existing = await User.findOne({ username: String(username).toLowerCase().trim() });
    if (existing) {
      return sendJson(res, 409, false, "Username already taken", null);
    }
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName: String(fullName).trim(),
      username: String(username).toLowerCase().trim(),
      password: hashed,
      role: "employee",
    });
    return sendJson(res, 201, true, "User created successfully", {
      id: user._id,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    if (err.code === 11000) {
      return sendJson(res, 409, false, "Username already taken", null);
    }
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return sendJson(res, 400, false, "username and password are required", null);
    }
    const user = await User.findOne({ username: String(username).toLowerCase().trim() }).select(
      "+password"
    );
    if (!user) {
      return sendJson(res, 401, false, "Invalid credentials", null);
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return sendJson(res, 401, false, "Invalid credentials", null);
    }
    const token = signToken(user);
    return sendJson(res, 200, true, "Login successful", {
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, false, "Internal server error", null);
  }
}

module.exports = { signup, login };
