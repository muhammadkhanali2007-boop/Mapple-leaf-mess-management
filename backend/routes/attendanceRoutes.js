const express = require("express");
const { create, getMine, update } = require("../controllers/attendanceController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", protect, create);
router.get("/me", protect, getMine);
router.put("/", protect, update);

module.exports = router;
