const jwt = require("jsonwebtoken");
const User = require("../models/User");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return sendJson(res, 401, false, "Not authorized: no token", null);
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error(new Error("JWT_SECRET is not set"));
      return sendJson(res, 401, false, "Internal server error", null);
    }
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return sendJson(res, 401, false, "Not authorized: user not found", null);
    }
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    return sendJson(res, 401, false, "Internal server error", null);
  }
}

module.exports = { protect };
