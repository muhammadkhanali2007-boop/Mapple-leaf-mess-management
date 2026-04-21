const express = require("express");
const { getEmployeeMessBundle } = require("../controllers/employeeMessController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/mess/employee-bundle", protect, getEmployeeMessBundle);

module.exports = router;
