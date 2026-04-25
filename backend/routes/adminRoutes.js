const express = require("express");
const {
  getTodayAttendance,
  getEmployeeAttendanceHistory,
  getEmployees,
  getTodayMess,
  patchMessMenu,
  getMealTemplateSuggestion,
  applyMealTemplateToToday,
  addMessIngredient,
  updateMessIngredient,
  deleteMessIngredient,
  assignCost,
  getReports,
} = require("../controllers/adminController");
const {
  listEmployeeData,
  getEmployeeHistoryAdmin,
  updateEmployeeData,
  deleteEmployeeData,
} = require("../controllers/employeeDataController");
const { verifyAdmin } = require("../middleware/adminMiddleware");

const router = express.Router();
console.log("ADMIN ROUTES LOADED");

router.get("/employee-data", verifyAdmin, listEmployeeData);
router.get("/employee-data/:employeeId/history", verifyAdmin, getEmployeeHistoryAdmin);
router.patch("/employee-data/:employeeId", verifyAdmin, updateEmployeeData);
router.delete("/employee-data/:employeeId", verifyAdmin, deleteEmployeeData);

router.get("/attendance/history/:employeeId", verifyAdmin, getEmployeeAttendanceHistory);
router.get("/attendance/today", verifyAdmin, getTodayAttendance);
router.get("/employees", verifyAdmin, getEmployees);
router.get("/mess/templates/suggest", verifyAdmin, getMealTemplateSuggestion);
router.post("/mess/today/use-template", verifyAdmin, applyMealTemplateToToday);
router.get("/mess/today", verifyAdmin, getTodayMess);
router.patch("/mess/today/menu", verifyAdmin, patchMessMenu);
router.post("/mess/today/ingredients", verifyAdmin, addMessIngredient);
router.patch("/mess/today/ingredients/:ingredientId", verifyAdmin, updateMessIngredient);
router.delete("/mess/today/ingredients/:ingredientId", verifyAdmin, deleteMessIngredient);
router.post("/mess/assign-cost", verifyAdmin, assignCost);
router.get("/reports", verifyAdmin, getReports);

module.exports = router;
