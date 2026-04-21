const express = require("express");
const {
  getTodayAttendance,
  getEmployees,
  getTodayMess,
  saveMess,
  assignCost,
  getReports,
} = require("../controllers/adminController");
const { verifyAdmin } = require("../middleware/adminMiddleware");

const router = express.Router();

router.get("/attendance/today", verifyAdmin, getTodayAttendance);
router.get("/employees", verifyAdmin, getEmployees);
router.get("/mess/today", verifyAdmin, getTodayMess);
router.post("/mess", verifyAdmin, saveMess);
router.post("/mess/assign-cost", verifyAdmin, assignCost);
router.get("/reports", verifyAdmin, getReports);

module.exports = router;
