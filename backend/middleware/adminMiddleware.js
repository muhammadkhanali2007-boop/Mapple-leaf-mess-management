const jwt = require("jsonwebtoken");

function sendJson(res, status, success, message, data = null) {
  return res.status(status).json({ success, message, data });
}

function verifyAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return sendJson(res, 401, false, "Internal server error", null);
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return sendJson(res, 500, false, "Internal server error", null);
    }
    const decoded = jwt.verify(token, secret);
    if (decoded.role !== "admin") {
      return sendJson(res, 403, false, "Forbidden", null);
    }
    req.admin = decoded;
    next();
  } catch (err) {
    console.error(err);
    return sendJson(res, 401, false, "Internal server error", null);
  }
}

module.exports = { verifyAdmin };
