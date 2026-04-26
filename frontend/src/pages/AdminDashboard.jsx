import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import adminApi from "../services/adminApi";
import mapleLeafLogo from "../assets/maple-leaf-logo.png";
import { localDateStr } from "../utils/date";
import {
  groupAttendanceByDate,
  formatHistoryDateHeading,
  formatAdminMealLines,
} from "../utils/attendanceHistoryGroup";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const TEST_MODE = true;

/** Group DailyReport rows by date with lunch + dinner slots (frontend only). */
function reportMealType(r) {
  return r?.mealType === "dinner" ? "dinner" : "lunch";
}

function groupReportsByDate(list) {
  const map = new Map();
  for (const r of list || []) {
    const d = r?.date;
    if (!d) continue;
    if (!map.has(d)) map.set(d, { date: d, lunch: null, dinner: null });
    map.get(d)[reportMealType(r)] = r;
  }
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function reportMealCells(r) {
  if (!r) {
    return { menu: "Not Available", expense: "—", present: "—", costHead: "—" };
  }
  const expense = r.totalCost ?? r.totalExpense ?? 0;
  return {
    menu: r.mess != null && String(r.mess).trim() !== "" ? r.mess : "—",
    expense,
    present: r.presentCount != null ? r.presentCount : "—",
    costHead: r.costPerHead != null && r.costPerHead !== "" ? r.costPerHead : "—",
  };
}

function nowClock() {
  return new Date().toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** YYYY-MM-DD → e.g. "23 Apr 2026" (Employee Data history table) */
function formatShortHistoryDate(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return String(iso);
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const day = Number(parts[2]);
  if (!y || !m || !day) return String(iso);
  return new Date(y, m - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function renderEmpHistoryStatusCell(status) {
  if (status === "Present") {
    return <span className="excel-badge excel-badge--present">Present</span>;
  }
  if (status === "Absent") {
    return <span className="excel-badge excel-badge--absent">Absent</span>;
  }
  return <span className="excel-badge excel-badge--neutral">Not marked</span>;
}

/** Plain string for Excel; mirrors renderEmpHistoryCostCell. */
function excelHistoryCostString(line) {
  if (line.cost === "Pending") {
    return "Pending";
  }
  if (line.cost === "—") {
    return "—";
  }
  if (line.status === "Absent" || line.cost === "0") {
    return "0";
  }
  return line.cost;
}

/** Uses formatAdminMealLines output (Pending / 0 / Rs. / —). */
function renderEmpHistoryCostCell(line) {
  if (line.cost === "Pending") {
    return <span className="excel-cell-muted">Pending</span>;
  }
  if (line.cost === "—") {
    return "—";
  }
  if (line.status === "Absent" || line.cost === "0") {
    return "0";
  }
  return line.cost;
}

function lockPhase() {
  const h = new Date().getHours();
  if (h >= 20) return "finalized";
  if (h >= 11) return "locked";
  return "open";
}

export default function AdminDashboard({ hidePanelLogout = false }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("attendance");
  const [clock, setClock] = useState(nowClock);

  const [summary, setSummary] = useState({
    totalEmployees: 0,
    todayPresentCount: 0,
    todayAbsentCount: 0,
    present: [],
    absent: [],
    lunch: { present: [], absent: [], presentCount: 0, absentCount: 0 },
    dinner: { present: [], absent: [], presentCount: 0, absentCount: 0 },
  });
  const [loadErr, setLoadErr] = useState("");

  const [messName, setMessName] = useState("");
  const [ingredients, setIngredients] = useState([]);
  const [newRow, setNewRow] = useState({ name: "", quantityKg: "", pricePerKg: "" });
  const [editingIdx, setEditingIdx] = useState(null);
  const [messMsg, setMessMsg] = useState("");
  const [messErr, setMessErr] = useState("");
  const [messSyncing, setMessSyncing] = useState(false);
  const [recipeSuggestion, setRecipeSuggestion] = useState(null);
  const [recipeLookupLoading, setRecipeLookupLoading] = useState(false);
  const [recipeLookupErr, setRecipeLookupErr] = useState("");
  /** Server flag: true after "Assign cost" (locks mess edits) */
  const [messIsFinalized, setMessIsFinalized] = useState(false);
  const [assignErr, setAssignErr] = useState("");
  /** Mess tab: "lunch" | "dinner" — API mealType */
  const [mealSection, setMealSection] = useState("lunch");

  const [reportStart, setReportStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localDateStr(d);
  });
  const [reportEnd, setReportEnd] = useState(() => localDateStr());
  const [reports, setReports] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  /** `${date}__${mealType}` so lunch/dinner on same day expand independently */
  const [expandedReportKey, setExpandedReportKey] = useState(null);

  const [historyModal, setHistoryModal] = useState({
    open: false,
    employeeId: "",
    employeeName: "",
    records: [],
    loading: false,
    error: "",
  });

  const [employeeRows, setEmployeeRows] = useState([]);
  /** Employee Data tab: name filter only */
  const [searchText, setSearchText] = useState("");
  const [employeeDataLoading, setEmployeeDataLoading] = useState(false);
  const [employeeDataErr, setEmployeeDataErr] = useState("");
  const [empHistoryModal, setEmpHistoryModal] = useState({
    open: false,
    employeeId: "",
    name: "",
    records: [],
    loading: false,
    error: "",
  });
  const [empEditModal, setEmpEditModal] = useState({
    open: false,
    employeeId: "",
    name: "",
    username: "",
    saving: false,
    error: "",
  });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const phase = TEST_MODE ? "open" : lockPhase();

  useEffect(() => {
    const t = setInterval(() => setClock(nowClock()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadAttendance = useCallback(async () => {
    setLoadErr("");
    try {
      const { data } = await adminApi.get("/api/admin/attendance/today");
      if (data.success && data.data) {
        setSummary({
          totalEmployees: data.data.totalEmployees ?? 0,
          todayPresentCount: data.data.todayPresentCount ?? 0,
          todayAbsentCount: data.data.todayAbsentCount ?? 0,
          present: data.data.present || [],
          absent: data.data.absent || [],
          lunch: data.data.lunch || { present: [], absent: [], presentCount: 0, absentCount: 0 },
          dinner: data.data.dinner || { present: [], absent: [], presentCount: 0, absentCount: 0 },
        });
      }
    } catch (e) {
      setLoadErr(e.response?.data?.message || "Failed to load attendance");
    }
  }, []);

  /* Entry point removed with Present/Absent tables; fetch + history modal state kept. */
  const _openHistory = useCallback(async (employeeId, employeeName) => {
    if (!employeeId) return;
    setHistoryModal({
      open: true,
      employeeId,
      employeeName,
      records: [],
      loading: true,
      error: "",
    });
    try {
      const { data } = await adminApi.get(
        `/api/admin/attendance/history/${encodeURIComponent(employeeId)}?days=30`
      );
      if (data.success && Array.isArray(data.data?.records)) {
        // Sorting handled by backend (.sort({ date: -1 })) — no need to sort on frontend
        setHistoryModal((m) => ({ ...m, loading: false, records: data.data.records }));
      } else {
        setHistoryModal((m) => ({
          ...m,
          loading: false,
          error: data.message || "Could not load history",
        }));
      }
    } catch (e) {
      setHistoryModal((m) => ({
        ...m,
        loading: false,
        error: e.response?.data?.message || "Could not load history",
      }));
    }
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryModal((m) => ({ ...m, open: false }));
  }, []);

  const loadEmployeeData = useCallback(async () => {
    setEmployeeDataErr("");
    setEmployeeDataLoading(true);
    try {
      const { data } = await adminApi.get("/api/admin/employee-data");
      if (data.success && Array.isArray(data.data?.employees)) {
        setEmployeeRows(data.data.employees);
      } else {
        setEmployeeRows([]);
        setEmployeeDataErr(data.message || "Failed to load employees");
      }
    } catch (e) {
      setEmployeeRows([]);
      setEmployeeDataErr(e.response?.data?.message || "Failed to load employees");
    } finally {
      setEmployeeDataLoading(false);
    }
  }, []);

  const openEmpHistory = useCallback(async (employeeId, name) => {
    setEmpHistoryModal({
      open: true,
      employeeId,
      name,
      records: [],
      loading: true,
      error: "",
    });
    try {
      const { data } = await adminApi.get(
        `/api/admin/employee-data/${encodeURIComponent(employeeId)}/history?days=30`
      );
      if (data.success && Array.isArray(data.data?.records)) {
        setEmpHistoryModal((m) => ({ ...m, loading: false, records: data.data.records }));
      } else {
        setEmpHistoryModal((m) => ({
          ...m,
          loading: false,
          error: data.message || "Could not load history",
        }));
      }
    } catch (e) {
      setEmpHistoryModal((m) => ({
        ...m,
        loading: false,
        error: e.response?.data?.message || "Could not load history",
      }));
    }
  }, []);

  const closeEmpHistory = useCallback(() => {
    setEmpHistoryModal((m) => ({ ...m, open: false }));
  }, []);

  const openEmpEdit = useCallback((row) => {
    setEmpEditModal({
      open: true,
      employeeId: row.id,
      name: row.name || "",
      username: row.username || "",
      saving: false,
      error: "",
    });
  }, []);

  const closeEmpEdit = useCallback(() => {
    setEmpEditModal((m) => ({ ...m, open: false }));
  }, []);

  async function saveEmpEdit() {
    const { employeeId, name, username } = empEditModal;
    setEmpEditModal((m) => ({ ...m, saving: true, error: "" }));
    try {
      const { data } = await adminApi.patch(`/api/admin/employee-data/${encodeURIComponent(employeeId)}`, {
        name,
        username,
      });
      if (data.success) {
        closeEmpEdit();
        loadEmployeeData();
      } else {
        setEmpEditModal((m) => ({ ...m, saving: false, error: data.message || "Save failed" }));
      }
    } catch (e) {
      setEmpEditModal((m) => ({
        ...m,
        saving: false,
        error: e.response?.data?.message || "Save failed",
      }));
    }
  }

  async function confirmDeleteEmployee() {
    if (!deleteTarget?.employeeId) return;
    try {
      await adminApi.delete(`/api/admin/employee-data/${encodeURIComponent(deleteTarget.employeeId)}`);
      setDeleteTarget(null);
      loadEmployeeData();
    } catch (e) {
      setEmployeeDataErr(e.response?.data?.message || "Delete failed");
      setDeleteTarget(null);
    }
  }

  function applyMessFromResponse(m) {
    if (!m) return;
    setMessName(m.messName || "");
    setMessIsFinalized(m.isFinalized === true);
    setIngredients(
      (m.ingredients || []).map((i, idx) => ({
        ...i,
        _key: i._id || idx,
      }))
    );
  }

  async function checkRecipeSuggestion(nameArg = messName) {
    const name = String(nameArg || "").trim();
    setRecipeLookupErr("");
    if (!name || messIsFinalized) {
      setRecipeSuggestion(null);
      return;
    }

    setRecipeLookupLoading(true);
    try {
      const { data } = await adminApi.get("/api/admin/mess/templates/suggest", {
        params: { messName: name },
      });
      if (data.success && data.data?.template) {
        setRecipeSuggestion(data.data.template);
      } else {
        setRecipeSuggestion(null);
      }
    } catch (e) {
      setRecipeSuggestion(null);
      setRecipeLookupErr(e.response?.data?.message || "Could not check previous recipes");
    } finally {
      setRecipeLookupLoading(false);
    }
  }

  async function usePreviousRecipe() {
    if (!recipeSuggestion?._id) return;
    setMessErr("");
    setMessMsg("");
    setMessSyncing(true);
    try {
      const mealType = mealSection === "dinner" ? "dinner" : "lunch";
      const { data } = await adminApi.post("/api/admin/mess/today/use-template", {
        templateId: recipeSuggestion._id,
        mealType,
      });
      if (data.success && data.data?.mess) {
        applyMessFromResponse(data.data.mess);
        setRecipeSuggestion(null);
        setMessMsg("Previous recipe loaded. You can edit it before assigning cost.");
      } else {
        setMessErr(data.message || "Could not use previous recipe");
      }
    } catch (e) {
      setMessErr(e.response?.data?.message || "Could not use previous recipe");
    } finally {
      setMessSyncing(false);
    }
  }

  const loadTodayMess = useCallback(async () => {
    try {
      const mt = mealSection === "dinner" ? "dinner" : "lunch";
      const { data } = await adminApi.get("/api/admin/mess/today", {
        params: { mealType: mt },
      });
      if (data.success && data.data?.mess) {
        applyMessFromResponse(data.data.mess);
        setRecipeSuggestion(null);
        setRecipeLookupErr("");
      } else {
        setMessName("");
        setIngredients([]);
        setMessIsFinalized(false);
        setRecipeSuggestion(null);
        setRecipeLookupErr("");
      }
    } catch {
      /* empty */
    }
  }, [mealSection]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    if (tab === "mess") loadTodayMess();
  }, [tab, mealSection, loadTodayMess]);

  useEffect(() => {
    if (tab === "employee-data") loadEmployeeData();
  }, [tab, loadEmployeeData]);

  const filteredEmployeeRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return employeeRows;
    return employeeRows.filter((emp) =>
      String(emp.name || "").toLowerCase().includes(q)
    );
  }, [employeeRows, searchText]);

  const refreshEmployeeData = useCallback(() => {
    setSearchText("");
    loadEmployeeData();
  }, [loadEmployeeData]);

  const totalExpense = useMemo(
    () =>
      ingredients.reduce((s, i) => {
        const line = Number(i.total);
        if (!Number.isNaN(line) && line >= 0) return s + line;
        return s + (Number(i.quantityKg) || 0) * (Number(i.pricePerKg) || 0);
      }, 0),
    [ingredients]
  );

  const presentForMess =
    mealSection === "dinner"
      ? (summary.dinner?.presentCount ?? 0)
      : (summary.lunch?.presentCount ?? 0);
  const costPreview = presentForMess > 0 ? totalExpense / presentForMess : null;

  const groupedHistoryModal = useMemo(
    () => groupAttendanceByDate(historyModal.records),
    [historyModal.records]
  );
  const groupedEmpHistoryModal = useMemo(
    () => groupAttendanceByDate(empHistoryModal.records),
    [empHistoryModal.records]
  );

  const groupedReports = useMemo(() => groupReportsByDate(reports), [reports]);

  // Employee history: styled header row requires ExcelJS; community `xlsx` does not write cell styles to .xlsx.
  const handleDownloadExcel = useCallback(async () => {
    try {
      const historyData = Array.isArray(empHistoryModal.records) ? empHistoryModal.records : [];
      if (historyData.length === 0) {
        alert("No data to export");
        return;
      }

      const grouped = groupAttendanceByDate(historyData);
      if (grouped.length === 0) {
        alert("No data to export");
        return;
      }

      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Employee History");

      const HEADER_BGS = ["FF4FA3BF", "FF8064A2", "FF9BBB59", "FFC0504D", "FF4F81BD"];
      const TITLES = ["Date", "Meal", "Status", "Menu", "Cost"];
      const headerRow = sheet.getRow(1);
      for (let i = 0; i < 5; i += 1) {
        const c = headerRow.getCell(i + 1);
        c.value = TITLES[i];
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BGS[i] } };
        c.font = { name: "Calibri", size: 20, bold: true, italic: true, color: { argb: "FF000000" } };
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
      headerRow.height = 32;

      sheet.getColumn(1).width = 20;
      sheet.getColumn(2).width = 12;
      sheet.getColumn(3).width = 12;
      sheet.getColumn(4).width = 24;
      sheet.getColumn(5).width = 16;

      let r = 2; // 1-based; row 1 = header
      for (const g of grouped) {
        const dateStr = formatShortHistoryDate(g.date);
        const lineL = formatAdminMealLines(g.lunch);
        const lineD = formatAdminMealLines(g.dinner);
        const rowL = sheet.getRow(r);
        rowL.getCell(1).value = dateStr;
        rowL.getCell(2).value = "Lunch";
        rowL.getCell(3).value = lineL.status;
        rowL.getCell(4).value = lineL.menu;
        rowL.getCell(5).value = excelHistoryCostString(lineL);
        const rowD = sheet.getRow(r + 1);
        rowD.getCell(1).value = null;
        rowD.getCell(2).value = "Dinner";
        rowD.getCell(3).value = lineD.status;
        rowD.getCell(4).value = lineD.menu;
        rowD.getCell(5).value = excelHistoryCostString(lineD);
        sheet.mergeCells(`A${r}:A${r + 1}`);
        r += 2;
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = String(empHistoryModal.name || "employee")
        .replace(/[/\\?%*:|"<>]/g, "_")
        .trim() || "employee";
      a.href = url;
      a.download = `${safe}_history.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Excel export error:", err);
      alert("Failed to download Excel");
    }
  }, [empHistoryModal.name, empHistoryModal.records]);

  async function saveMessMenu() {
    try {
      const mealType = mealSection === "dinner" ? "dinner" : "lunch";
      const name = messName.trim();
      const { data } = await adminApi.patch("/api/admin/mess/today/menu", { messName: name, mealType });
      if (data.success && data.data?.mess) {
        applyMessFromResponse(data.data.mess);
      }
      await checkRecipeSuggestion(name);
    } catch (e) {
      setRecipeSuggestion(null);
      setRecipeLookupErr(e.response?.data?.message || "Could not save menu");
    }
  }

  async function addIngredient(e) {
    e?.preventDefault();
    const qty = Number(newRow.quantityKg);
    const price = Number(newRow.pricePerKg);
    if (!newRow.name?.trim()) {
      setMessErr("Enter ingredient name");
      return;
    }
    if (Number.isNaN(qty) || qty < 0 || Number.isNaN(price) || price < 0) {
      setMessErr("Enter valid quantity and price");
      return;
    }
    setMessErr("");
    setMessMsg("");
    setMessSyncing(true);
    try {
      const mealType = mealSection === "dinner" ? "dinner" : "lunch";
      const { data } = await adminApi.post("/api/admin/mess/today/ingredients", {
        name: newRow.name.trim(),
        quantityKg: qty,
        pricePerKg: price,
        mealType,
      });
      if (data.success && data.data?.mess) {
        applyMessFromResponse(data.data.mess);
        setNewRow({ name: "", quantityKg: "", pricePerKg: "" });
      } else {
        setMessErr(data.message || "Add failed");
      }
    } catch (err) {
      setMessErr(err.response?.data?.message || "Add failed");
    } finally {
      setMessSyncing(false);
    }
  }

  async function deleteIngredient(idx) {
    const row = ingredients[idx];
    if (!row?._id) return;
    setMessErr("");
    setMessMsg("");
    setMessSyncing(true);
    try {
      const mealType = mealSection === "dinner" ? "dinner" : "lunch";
      const { data } = await adminApi.delete(
        `/api/admin/mess/today/ingredients/${encodeURIComponent(row._id)}`,
        { params: { mealType } }
      );
      if (data.success && data.data?.mess) {
        applyMessFromResponse(data.data.mess);
        if (editingIdx === idx) setEditingIdx(null);
      } else {
        setMessErr(data.message || "Delete failed");
      }
    } catch (err) {
      setMessErr(err.response?.data?.message || "Delete failed");
    } finally {
      setMessSyncing(false);
    }
  }

  async function saveIngredientEdit(idx) {
    const row = ingredients[idx];
    if (!row?._id) return;
    setMessErr("");
    setMessMsg("");
    setMessSyncing(true);
    try {
      const mealType = mealSection === "dinner" ? "dinner" : "lunch";
      const { data } = await adminApi.patch(
        `/api/admin/mess/today/ingredients/${encodeURIComponent(row._id)}`,
        {
          name: row.name,
          quantityKg: row.quantityKg,
          pricePerKg: row.pricePerKg,
          mealType,
        }
      );
      if (data.success && data.data?.mess) {
        applyMessFromResponse(data.data.mess);
        setEditingIdx(null);
      } else {
        setMessErr(data.message || "Update failed");
      }
    } catch (err) {
      setMessErr(err.response?.data?.message || "Update failed");
    } finally {
      setMessSyncing(false);
    }
  }

  async function assignCost() {
    setAssignErr("");
    if (messIsFinalized) {
      setAssignErr(
        `Today's ${mealSection === "dinner" ? "dinner" : "lunch"} cost is already finalized and cannot be changed`
      );
      return;
    }
    if (phase === "finalized") {
      setAssignErr("Day finalized — no edits allowed");
      return;
    }
    if (presentForMess === 0) {
      setAssignErr("No present employees to assign cost");
      return;
    }
    try {
      const mealType = mealSection === "dinner" ? "dinner" : "lunch";
      const { data } = await adminApi.post("/api/admin/mess/assign-cost", {
        costPerPerson: costPreview,
        date: localDateStr(),
        mealType,
      });
      if (data.success) {
        if (data.data?.mess) {
          applyMessFromResponse(data.data.mess);
        }
        setMessMsg("Cost assigned successfully");
        await Promise.all([loadAttendance(), loadTodayMess()]);
      } else {
        setAssignErr(data.message || "Assign failed");
      }
    } catch (e) {
      setAssignErr(e.response?.data?.message || "Assign failed");
    }
  }

  async function loadReports() {
    setReportLoading(true);
    try {
      const { data } = await adminApi.get("/api/admin/reports", {
        params: { from: reportStart, to: reportEnd },
      });
      if (data.success && data.data?.reports) {
        setReports(data.data.reports);
      } else {
        setReports([]);
      }
    } catch {
      setReports([]);
    } finally {
      setReportLoading(false);
    }
  }

  function exportCsv() {
    const headers = ["Date", "Meal", "Menu", "Total Expense", "Present Count", "Cost per Head"];
    const lines = [headers.join(",")];
    groupReportsByDate(reports).forEach((g) => {
      lines.push([g.date, "(date)", "", "", "", ""].join(","));
      const pushMeal = (label, r) => {
        const c = reportMealCells(r);
        const menu = `"${String(c.menu).replace(/"/g, '""')}"`;
        lines.push([g.date, label, menu, c.expense, c.present, c.costHead].join(","));
      };
      pushMeal("Lunch", g.lunch);
      pushMeal("Dinner", g.dinner);
      const lE = g.lunch ? Number(g.lunch.totalCost ?? g.lunch.totalExpense ?? 0) : 0;
      const dE = g.dinner ? Number(g.dinner.totalCost ?? g.dinner.totalExpense ?? 0) : 0;
      const lP = g.lunch?.presentCount != null ? Number(g.lunch.presentCount) : 0;
      const dP = g.dinner?.presentCount != null ? Number(g.dinner.presentCount) : 0;
      lines.push([g.date, "Total (day)", "", lE + dE, lP + dP, ""].join(","));
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mess-report-${reportStart}-${reportEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportXlsx() {
    const rows = [];
    groupReportsByDate(reports).forEach((g) => {
      rows.push({ Date: g.date, Meal: "(date)", Menu: "", "Total Expense": "", "Present Count": "", "Cost per Head": "" });
      const add = (label, r) => {
        const c = reportMealCells(r);
        rows.push({
          Date: g.date,
          Meal: label,
          Menu: c.menu,
          "Total Expense": c.expense,
          "Present Count": c.present,
          "Cost per Head": c.costHead,
        });
      };
      add("Lunch", g.lunch);
      add("Dinner", g.dinner);
      const lE = g.lunch ? Number(g.lunch.totalCost ?? g.lunch.totalExpense ?? 0) : 0;
      const dE = g.dinner ? Number(g.dinner.totalCost ?? g.dinner.totalExpense ?? 0) : 0;
      const lP = g.lunch?.presentCount != null ? Number(g.lunch.presentCount) : 0;
      const dP = g.dinner?.presentCount != null ? Number(g.dinner.presentCount) : 0;
      rows.push({
        Date: g.date,
        Meal: "Total (day)",
        Menu: "",
        "Total Expense": lE + dE,
        "Present Count": lP + dP,
        "Cost per Head": "",
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `mess-report-${reportStart}-${reportEnd}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Mess Management Report", 14, 12);
    doc.setFontSize(10);
    doc.text(`Range: ${reportStart} to ${reportEnd}`, 14, 18);
    const pdfBody = [];
    groupReportsByDate(reports).forEach((g) => {
      pdfBody.push([g.date, "(date)", "", "", "", ""]);
      const row = (label, r) => {
        const c = reportMealCells(r);
        return [g.date, label, String(c.menu), String(c.expense), String(c.present), String(c.costHead)];
      };
      pdfBody.push(row("Lunch", g.lunch));
      pdfBody.push(row("Dinner", g.dinner));
      const lE = g.lunch ? Number(g.lunch.totalCost ?? g.lunch.totalExpense ?? 0) : 0;
      const dE = g.dinner ? Number(g.dinner.totalCost ?? g.dinner.totalExpense ?? 0) : 0;
      const lP = g.lunch?.presentCount != null ? Number(g.lunch.presentCount) : 0;
      const dP = g.dinner?.presentCount != null ? Number(g.dinner.presentCount) : 0;
      pdfBody.push([g.date, "Total (day)", "", String(lE + dE), String(lP + dP), ""]);
    });
    autoTable(doc, {
      startY: 22,
      head: [["Date", "Meal", "Menu", "Total Expense", "Present", "Cost / Head"]],
      body: pdfBody,
    });
    doc.save(`mess-report-${reportStart}-${reportEnd}.pdf`);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  }

  const messDisabled = messIsFinalized || phase === "finalized";
  const messInputsDisabled = messDisabled || messSyncing;

  return (
    <div className="admin-app">
      <header className="admin-nav-bar">
        <div className="admin-nav-bar__brand">
          <img className="admin-brand__logo" src={mapleLeafLogo} alt="Maple Leaf Cement Factory Limited" />
          <h1 className="admin-brand">Maple Leaf Mess Management</h1>
        </div>
        <nav className="admin-nav-bar__tabs" aria-label="Admin sections">
          <button
            type="button"
            className={tab === "attendance" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("attendance")}
          >
            Attendance
          </button>
          <button
            type="button"
            className={tab === "mess" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("mess")}
          >
            Mess Management
          </button>
          <button
            type="button"
            className={tab === "reports" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("reports")}
          >
            Reports
          </button>
          <button
            type="button"
            className={tab === "employee-data" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("employee-data")}
          >
            Employee Data
          </button>
        </nav>
        <div className="admin-nav-bar__right">
          <span className="admin-clock-inline">{clock}</span>
          {!hidePanelLogout && (
            <button type="button" className="excel-btn excel-btn--outline" onClick={logout}>
              Logout
            </button>
          )}
        </div>
      </header>

      {phase === "locked" && (
        <div className="admin-banner admin-banner--yellow">
          ⚠️ Attendance Locked — 11:00 AM passed
        </div>
      )}
      {phase === "finalized" && (
        <div className="admin-banner admin-banner--red">
          🔒 Day Finalized — No edits allowed
        </div>
      )}

      {tab === "attendance" && (
        <>
          <div className="admin-summary">
            <div className="admin-card admin-card--gray">
              <div className="admin-card__label">Total Employees</div>
              <div className="admin-card__value">{summary.totalEmployees}</div>
            </div>
            <div className="admin-card admin-card--green">
              <div className="admin-card__label">Lunch — Present</div>
              <div className="admin-card__value">{summary.lunch?.presentCount ?? 0}</div>
            </div>
            <div className="admin-card admin-card--red">
              <div className="admin-card__label">Lunch — Absent</div>
              <div className="admin-card__value">{summary.lunch?.absentCount ?? 0}</div>
            </div>
            <div className="admin-card admin-card--green">
              <div className="admin-card__label">Dinner — Present</div>
              <div className="admin-card__value">{summary.dinner?.presentCount ?? 0}</div>
            </div>
            <div className="admin-card admin-card--red">
              <div className="admin-card__label">Dinner — Absent</div>
              <div className="admin-card__value">{summary.dinner?.absentCount ?? 0}</div>
            </div>
          </div>

          {loadErr && <p className="excel-msg excel-msg--error">{loadErr}</p>}

          {historyModal.open && (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => e.target === e.currentTarget && closeHistory()}
            >
              <div className="admin-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
                <h3 className="admin-modal__title">
                  Attendance history — {historyModal.employeeName || "Employee"} (30 days)
                </h3>
                {historyModal.loading && <p className="excel-cell-muted">Loading…</p>}
                {historyModal.error && <p className="excel-msg excel-msg--error">{historyModal.error}</p>}
                {!historyModal.loading && !historyModal.error && (
                  <div className="excel-table-wrap att-history-list-wrap" style={{ maxHeight: 360, overflow: "auto" }}>
                    {groupedHistoryModal.length === 0 ? (
                      <p className="excel-cell-muted" role="status">
                        No attendance recorded
                      </p>
                    ) : (
                      <div className="att-history-list att-history-list--in-modal">
                        {groupedHistoryModal.map((g) => (
                          <div key={g.date} className="att-history-day">
                            <h4 className="att-history-day__title">{formatHistoryDateHeading(g.date)}</h4>
                            {["lunch", "dinner"].map((meal) => {
                              const rec = g[meal];
                              const line = formatAdminMealLines(rec);
                              const label = meal === "dinner" ? "🍽️ Dinner" : "🍱 Lunch";
                              const costNode =
                                line.cost === "Pending" ? (
                                  <span className="excel-cell-muted">Pending</span>
                                ) : (
                                  line.cost
                                );
                              return (
                                <div key={meal} className="att-history-meal">
                                  <div className="att-history-meal__name">{label}</div>
                                  <div className="att-history-meal__line">Status: {line.status}</div>
                                  <div className="att-history-meal__line">Menu: {line.menu}</div>
                                  <div className="att-history-meal__line">Cost: {costNode}</div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="excel-btn excel-btn--primary" style={{ marginTop: "1rem" }} onClick={closeHistory}>
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "mess" && (
        <div className="admin-mess">
          <div
            className="admin-mess__switch"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            <h2 className="admin-section-title admin-section-title--mess-highlight" style={{ margin: 0 }}>
              {mealSection === "dinner" ? "Dinner Mess Management" : "Lunch Mess Management"}
            </h2>
            <button
              type="button"
              className="excel-btn excel-btn--outline"
              onClick={() => {
                setMessMsg("");
                setAssignErr("");
                setRecipeSuggestion(null);
                setRecipeLookupErr("");
                setMealSection((m) => (m === "lunch" ? "dinner" : "lunch"));
              }}
            >
              {mealSection === "lunch" ? "Dinner Management" : "Lunch Management"}
            </button>
          </div>
          {messIsFinalized && (
            <div className="admin-banner admin-banner--red" role="status" style={{ marginBottom: "1rem" }}>
              Today&apos;s {mealSection === "dinner" ? "dinner" : "lunch"} cost is finalized and cannot be changed
            </div>
          )}
          <h2 className="admin-section-title">Step 1 — Today&apos;s Menu ({mealSection === "dinner" ? "Dinner" : "Lunch"})</h2>
          <label className="excel-label admin-menu-label">Today&apos;s Menu</label>
          <div className="admin-mess-row">
            <input
              className="excel-input admin-mess-input"
              placeholder="e.g. Mutton + Rice"
              value={messName}
              onChange={(e) => {
                setMessName(e.target.value);
                setRecipeSuggestion(null);
                setRecipeLookupErr("");
              }}
              onBlur={saveMessMenu}
              disabled={messInputsDisabled}
            />
            <span className="excel-note" style={{ alignSelf: "center" }}>
              Menu name saves when you leave this field
            </span>
          </div>
          {recipeLookupLoading && <p className="excel-note">Checking previous recipes…</p>}
          {recipeLookupErr && <p className="excel-msg excel-msg--error">{recipeLookupErr}</p>}
          {recipeSuggestion && !messInputsDisabled && (
            <div className="meal-template-suggestion" role="status">
              <div>
                <strong>
                  Previous recipe found for {recipeSuggestion.name} ({recipeSuggestion.versionLabel || "v1"}). Use it?
                </strong>
                <p>
                  {recipeSuggestion.ingredients?.length || 0} ingredient
                  {(recipeSuggestion.ingredients?.length || 0) === 1 ? "" : "s"} will be loaded for review.
                </p>
              </div>
              <button
                type="button"
                className="excel-btn excel-btn--primary"
                onClick={usePreviousRecipe}
                disabled={messInputsDisabled || messSyncing}
              >
                Use Previous Recipe
              </button>
            </div>
          )}

          <h2 className="admin-section-title">
            Step 2 — Ingredients ({mealSection === "dinner" ? "Dinner" : "Lunch"})
          </h2>
          <form className="admin-ing-add" onSubmit={addIngredient}>
            <input
              className="excel-input"
              placeholder="Ingredient Name"
              value={newRow.name}
              onChange={(e) => setNewRow((x) => ({ ...x, name: e.target.value }))}
              disabled={messInputsDisabled}
            />
            <input
              className="excel-input"
              placeholder="Quantity (KG)"
              type="number"
              step="0.01"
              min="0"
              value={newRow.quantityKg}
              onChange={(e) => setNewRow((x) => ({ ...x, quantityKg: e.target.value }))}
              disabled={messInputsDisabled}
            />
            <input
              className="excel-input"
              placeholder="Price per KG"
              type="number"
              step="0.01"
              min="0"
              value={newRow.pricePerKg}
              onChange={(e) => setNewRow((x) => ({ ...x, pricePerKg: e.target.value }))}
              disabled={messInputsDisabled}
            />
            <button type="submit" className="excel-btn excel-btn--primary" disabled={messInputsDisabled}>
              Add
            </button>
          </form>
          {messErr && <p className="excel-msg excel-msg--error">{messErr}</p>}
          {messMsg && <p className="excel-msg excel-msg--ok">{messMsg}</p>}

          <div className="excel-table-wrap">
            <table className="excel-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Qty (KG)</th>
                  <th>Price/KG</th>
                  <th>Total (Rs.)</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {ingredients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="excel-cell-muted">
                      No ingredients yet
                    </td>
                  </tr>
                ) : (
                  ingredients.map((row, idx) => (
                    <tr key={row._key || idx}>
                      {editingIdx === idx ? (
                        <>
                          <td>{idx + 1}</td>
                          <td>
                            <input
                              className="excel-input"
                              value={row.name}
                              disabled={messInputsDisabled}
                              onChange={(e) => {
                                const v = e.target.value;
                                setIngredients((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, name: v } : p))
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="excel-input"
                              type="number"
                              value={row.quantityKg}
                              disabled={messInputsDisabled}
                              onChange={(e) => {
                                const qty = Number(e.target.value);
                                setIngredients((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    const total = qty * p.pricePerKg;
                                    return { ...p, quantityKg: qty, total };
                                  })
                                );
                              }}
                            />
                          </td>
                          <td>
                            <input
                              className="excel-input"
                              type="number"
                              value={row.pricePerKg}
                              disabled={messInputsDisabled}
                              onChange={(e) => {
                                const price = Number(e.target.value);
                                setIngredients((prev) =>
                                  prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    const total = p.quantityKg * price;
                                    return { ...p, pricePerKg: price, total };
                                  })
                                );
                              }}
                            />
                          </td>
                          <td>{(row.quantityKg * row.pricePerKg).toFixed(2)}</td>
                          <td>
                            <button
                              type="button"
                              className="excel-btn excel-btn--sm"
                              disabled={messInputsDisabled}
                              onClick={() => saveIngredientEdit(idx)}
                            >
                              Done
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="excel-btn excel-btn--sm"
                              disabled={messInputsDisabled}
                              onClick={() => deleteIngredient(idx)}
                            >
                              Delete
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{idx + 1}</td>
                          <td>{row.name}</td>
                          <td>{row.quantityKg}</td>
                          <td>{row.pricePerKg}</td>
                          <td>{Number(row.total).toFixed(2)}</td>
                          <td>
                            <button
                              type="button"
                              className="excel-btn excel-btn--sm"
                              onClick={() => setEditingIdx(idx)}
                              disabled={messInputsDisabled}
                            >
                              Edit
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="excel-btn excel-btn--sm"
                              onClick={() => deleteIngredient(idx)}
                              disabled={messInputsDisabled}
                            >
                              Delete
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {ingredients.length > 0 && (
                <tfoot>
                  <tr className="admin-ing-total">
                    <td colSpan={4} className="admin-ing-total-label">
                      <strong>Total Expense</strong>
                    </td>
                    <td colSpan={3}>
                      <strong>Rs. {totalExpense.toFixed(2)}</strong>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <h2 className="admin-section-title">
            Step 3 — Cost division ({mealSection === "dinner" ? "Dinner" : "Lunch"})
          </h2>
          <div className="admin-cost-boxes">
            <div className="admin-cost-box">
              <div className="admin-cost-box__label">
                Present ({mealSection === "dinner" ? "Dinner" : "Lunch"}) — today
              </div>
              <div className="admin-cost-box__value">{presentForMess}</div>
            </div>
            <div className="admin-cost-box">
              <div className="admin-cost-box__label">Cost per Person</div>
              <div className="admin-cost-box__value">
                {costPreview != null && presentForMess > 0 ? `Rs. ${costPreview.toFixed(2)}` : "—"}
              </div>
            </div>
          </div>
          {presentForMess === 0 && (
            <p className="excel-msg excel-msg--error">No present employees to assign cost for this meal</p>
          )}

          <h2 className="admin-section-title">
            Step 4 — Assign cost ({mealSection === "dinner" ? "Dinner" : "Lunch"})
          </h2>
          <button
            type="button"
            className="excel-btn excel-btn--primary excel-btn--assign"
            onClick={assignCost}
            disabled={messInputsDisabled || totalExpense <= 0}
          >
            Assign Cost to Present Employees
          </button>
          {assignErr && <p className="excel-msg excel-msg--error">{assignErr}</p>}
        </div>
      )}

      {tab === "reports" && (
        <div className="admin-reports">
          <div className="admin-filters admin-filters--reports">
            <label>
              From:
              <input
                type="date"
                className="excel-input"
                value={reportStart}
                onChange={(e) => setReportStart(e.target.value)}
              />
            </label>
            <label>
              To:
              <input type="date" className="excel-input" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} />
            </label>
            <button type="button" className="excel-btn excel-btn--primary" onClick={loadReports} disabled={reportLoading}>
              {reportLoading ? "Loading…" : "Apply Filter"}
            </button>
          </div>
          <div className="admin-export">
            <button type="button" className="excel-btn excel-btn--outline" onClick={exportCsv} disabled={!reports.length}>
              Export CSV
            </button>
            <button type="button" className="excel-btn excel-btn--outline" onClick={exportXlsx} disabled={!reports.length}>
              Export Excel (.xlsx)
            </button>
            <button type="button" className="excel-btn excel-btn--outline" onClick={exportPdf} disabled={!reports.length}>
              Export PDF
            </button>
          </div>
          <div className="excel-table-wrap">
            {reports.length === 0 ? (
              <p className="excel-cell-muted" style={{ padding: "1rem" }}>
                No data — set dates and Apply
              </p>
            ) : (
              <div className="admin-report-day-list">
                {groupedReports.map((g) => {
                  const lunchC = reportMealCells(g.lunch);
                  const dinnerC = reportMealCells(g.dinner);
                  const rkL = `${g.date}__lunch`;
                  const rkD = `${g.date}__dinner`;
                  const lunchExp = g.lunch ? Number(g.lunch.totalCost ?? g.lunch.totalExpense ?? 0) : 0;
                  const dinnerExp = g.dinner ? Number(g.dinner.totalCost ?? g.dinner.totalExpense ?? 0) : 0;
                  const lunchP = g.lunch?.presentCount != null ? Number(g.lunch.presentCount) : 0;
                  const dinnerP = g.dinner?.presentCount != null ? Number(g.dinner.presentCount) : 0;
                  const totalExp = lunchExp + dinnerExp;
                  const totalPresent = lunchP + dinnerP;
                  return (
                    <div
                      key={g.date}
                      className="admin-report-day-block"
                      style={{
                        marginBottom: "1.25rem",
                        padding: "1rem",
                        border: "1px solid var(--ml-border)",
                        borderRadius: "6px",
                        background: "var(--ml-surface)",
                      }}
                    >
                      <h3 className="admin-section-title" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
                        📅 {formatHistoryDateHeading(g.date)}
                      </h3>
                      <h4 style={{ margin: "0.5rem 0 0.35rem", fontSize: "0.95rem", fontWeight: 600 }}>🍽️ Lunch</h4>
                      <table className="excel-table" style={{ marginBottom: "0.85rem" }}>
                        <thead>
                          <tr>
                            <th style={{ width: "2.25rem" }} />
                            <th>Menu</th>
                            <th>Total Expense</th>
                            <th>Present Count</th>
                            <th>Cost per Head</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              {g.lunch ? (
                                <button
                                  type="button"
                                  className="excel-btn excel-btn--sm"
                                  onClick={() => setExpandedReportKey((x) => (x === rkL ? null : rkL))}
                                >
                                  {expandedReportKey === rkL ? "−" : "+"}
                                </button>
                              ) : (
                                <span className="excel-cell-muted">—</span>
                              )}
                            </td>
                            <td>{lunchC.menu}</td>
                            <td>{lunchC.expense}</td>
                            <td>{lunchC.present}</td>
                            <td>{lunchC.costHead}</td>
                          </tr>
                          {expandedReportKey === rkL && g.lunch && (
                            <tr className="admin-report-detail">
                              <td colSpan={5}>
                                <div className="excel-table-wrap">
                                  <table className="excel-table">
                                    <thead>
                                      <tr>
                                        <th>Name</th>
                                        <th>Qty (KG)</th>
                                        <th>Price/KG</th>
                                        <th>Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(g.lunch.ingredients || []).length === 0 ? (
                                        <tr>
                                          <td colSpan={4} className="excel-cell-muted">
                                            No ingredient rows
                                          </td>
                                        </tr>
                                      ) : (
                                        g.lunch.ingredients.map((ing, j) => (
                                          <tr key={j}>
                                            <td>{ing.name}</td>
                                            <td>{ing.quantityKg}</td>
                                            <td>{ing.pricePerKg}</td>
                                            <td>{ing.total}</td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <h4 style={{ margin: "0.5rem 0 0.35rem", fontSize: "0.95rem", fontWeight: 600 }}>🌙 Dinner</h4>
                      <table className="excel-table" style={{ marginBottom: "0.75rem" }}>
                        <thead>
                          <tr>
                            <th style={{ width: "2.25rem" }} />
                            <th>Menu</th>
                            <th>Total Expense</th>
                            <th>Present Count</th>
                            <th>Cost per Head</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              {g.dinner ? (
                                <button
                                  type="button"
                                  className="excel-btn excel-btn--sm"
                                  onClick={() => setExpandedReportKey((x) => (x === rkD ? null : rkD))}
                                >
                                  {expandedReportKey === rkD ? "−" : "+"}
                                </button>
                              ) : (
                                <span className="excel-cell-muted">—</span>
                              )}
                            </td>
                            <td>{dinnerC.menu}</td>
                            <td>{dinnerC.expense}</td>
                            <td>{dinnerC.present}</td>
                            <td>{dinnerC.costHead}</td>
                          </tr>
                          {expandedReportKey === rkD && g.dinner && (
                            <tr className="admin-report-detail">
                              <td colSpan={5}>
                                <div className="excel-table-wrap">
                                  <table className="excel-table">
                                    <thead>
                                      <tr>
                                        <th>Name</th>
                                        <th>Qty (KG)</th>
                                        <th>Price/KG</th>
                                        <th>Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(g.dinner.ingredients || []).length === 0 ? (
                                        <tr>
                                          <td colSpan={4} className="excel-cell-muted">
                                            No ingredient rows
                                          </td>
                                        </tr>
                                      ) : (
                                        g.dinner.ingredients.map((ing, j) => (
                                          <tr key={j}>
                                            <td>{ing.name}</td>
                                            <td>{ing.quantityKg}</td>
                                            <td>{ing.pricePerKg}</td>
                                            <td>{ing.total}</td>
                                          </tr>
                                        ))
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div
                        style={{
                          marginTop: "0.35rem",
                          paddingTop: "0.65rem",
                          borderTop: "1px solid var(--ml-border)",
                          fontSize: "0.9rem",
                          fontWeight: 600,
                        }}
                      >
                        Day total — Total expense: {totalExp} · Present (lunch + dinner): {totalPresent}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "employee-data" && (
        <div className="admin-employee-data">
          <h2 className="admin-section-title">Employee master list</h2>
          <p className="excel-note" style={{ marginBottom: "0.75rem" }}>
            One row per registered employee (same as signup). Deleting removes the user and all attendance rows for that
            employee.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
            <button type="button" className="excel-btn excel-btn--outline" onClick={refreshEmployeeData} disabled={employeeDataLoading}>
              Refresh
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              Search by Name
              <input
                type="search"
                className="excel-input"
                placeholder="Type to filter…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                autoComplete="off"
                style={{ minWidth: "12rem" }}
              />
            </label>
          </div>
          {employeeDataErr && <p className="excel-msg excel-msg--error">{employeeDataErr}</p>}
          <div className="excel-table-wrap" style={{ marginTop: "0.75rem" }}>
            <table className="excel-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Employee ID</th>
                  <th>Created</th>
                  <th>Total attendance (30 days)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employeeDataLoading ? (
                  <tr>
                    <td colSpan={6} className="excel-cell-muted">
                      Loading…
                    </td>
                  </tr>
                ) : employeeRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="excel-cell-muted">
                      No employees
                    </td>
                  </tr>
                ) : filteredEmployeeRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="excel-cell-muted">
                      No employees match this search
                    </td>
                  </tr>
                ) : (
                  filteredEmployeeRows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Name">{row.name}</td>
                      <td data-label="Username">{row.username}</td>
                      <td data-label="Employee ID">{row.employeeId || "—"}</td>
                      <td data-label="Created">
                        {row.createdAt
                          ? new Date(row.createdAt).toISOString().slice(0, 10)
                          : "—"}
                      </td>
                      <td data-label="Attendance">{row.totalAttendance30Days ?? 0}</td>
                      <td data-label="Actions">
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                          <button
                            type="button"
                            className="excel-btn excel-btn--outline"
                            style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
                            onClick={() => openEmpHistory(row.id, row.name)}
                          >
                            View History
                          </button>
                          <button
                            type="button"
                            className="excel-btn excel-btn--outline"
                            style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
                            onClick={() => openEmpEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="excel-btn excel-btn--outline"
                            style={{ padding: "0.2rem 0.45rem", fontSize: "0.8rem" }}
                            onClick={() => setDeleteTarget({ employeeId: row.id, name: row.name })}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {empHistoryModal.open && (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => e.target === e.currentTarget && closeEmpHistory()}
            >
              <div className="admin-modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    marginBottom: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <h3 className="admin-modal__title" style={{ margin: 0, flex: "1 1 auto" }}>
                    History — {empHistoryModal.name} (30 days)
                  </h3>
                  <button
                    type="button"
                    className="excel-btn excel-btn--outline"
                    style={{ flexShrink: 0 }}
                    onClick={handleDownloadExcel}
                    disabled={
                      empHistoryModal.loading || !empHistoryModal.records || empHistoryModal.records.length === 0
                    }
                  >
                    Download Excel
                  </button>
                </div>
                {empHistoryModal.loading && <p className="excel-cell-muted">Loading…</p>}
                {empHistoryModal.error && <p className="excel-msg excel-msg--error">{empHistoryModal.error}</p>}
                {!empHistoryModal.loading && !empHistoryModal.error && (
                  <div
                    className="excel-table-wrap att-history-list-wrap emp-history-table-scroll"
                    style={{ maxHeight: 380, overflow: "auto" }}
                  >
                    {groupedEmpHistoryModal.length === 0 ? (
                      <p className="excel-cell-muted" role="status">
                        No attendance recorded
                      </p>
                    ) : (
                      <div className="emp-history-data-wrap" role="region" aria-label="Employee attendance history by date">
                        <table className="excel-table emp-history-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Meal</th>
                              <th>Status</th>
                              <th>Menu</th>
                              <th>Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupedEmpHistoryModal.map((g, gi) => {
                              const dateLabel = formatShortHistoryDate(g.date);
                              const last = gi === groupedEmpHistoryModal.length - 1;
                              return (
                                <Fragment key={g.date}>
                                  {["lunch", "dinner"].map((meal) => {
                                    const rec = g[meal];
                                    const line = formatAdminMealLines(rec);
                                    const isLunch = meal === "lunch";
                                    return (
                                      <tr
                                        key={meal}
                                        className={
                                          isLunch
                                            ? "emp-history-tr emp-history-tr--lunch"
                                            : "emp-history-tr emp-history-tr--dinner"
                                        }
                                      >
                                        <td className="emp-history-td--date">
                                          {isLunch ? dateLabel : ""}
                                        </td>
                                        <td
                                          className={
                                            isLunch ? "emp-history-meal--lunch" : "emp-history-meal--dinner"
                                          }
                                        >
                                          {isLunch ? "Lunch" : "Dinner"}
                                        </td>
                                        <td className="emp-history-td--status">
                                          {renderEmpHistoryStatusCell(line.status)}
                                        </td>
                                        <td>{line.menu}</td>
                                        <td>{renderEmpHistoryCostCell(line)}</td>
                                      </tr>
                                    );
                                  })}
                                  {!last && (
                                    <tr className="emp-history-gap" aria-hidden>
                                      <td colSpan={5} />
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="excel-btn excel-btn--primary" style={{ marginTop: "1rem" }} onClick={closeEmpHistory}>
                  Close
                </button>
              </div>
            </div>
          )}

          {empEditModal.open && (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => e.target === e.currentTarget && !empEditModal.saving && closeEmpEdit()}
            >
              <div className="admin-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
                <h3 className="admin-modal__title">Edit employee</h3>
                <label className="excel-label">
                  Name
                  <input
                    className="excel-input"
                    value={empEditModal.name}
                    onChange={(e) => setEmpEditModal((m) => ({ ...m, name: e.target.value }))}
                    disabled={empEditModal.saving}
                  />
                </label>
                <label className="excel-label">
                  Username
                  <input
                    className="excel-input"
                    value={empEditModal.username}
                    onChange={(e) => setEmpEditModal((m) => ({ ...m, username: e.target.value }))}
                    disabled={empEditModal.saving}
                  />
                </label>
                {empEditModal.error && <p className="excel-msg excel-msg--error">{empEditModal.error}</p>}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button type="button" className="excel-btn excel-btn--primary" onClick={saveEmpEdit} disabled={empEditModal.saving}>
                    {empEditModal.saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="excel-btn excel-btn--outline" onClick={closeEmpEdit} disabled={empEditModal.saving}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {deleteTarget && (
            <div
              className="admin-modal-backdrop"
              role="presentation"
              onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                <h3 className="admin-modal__title">Delete employee?</h3>
                <p>
                  Remove <strong>{deleteTarget.name}</strong> and all their attendance records? This cannot be undone.
                </p>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
                  <button type="button" className="excel-btn excel-btn--primary" onClick={confirmDeleteEmployee}>
                    Delete
                  </button>
                  <button type="button" className="excel-btn excel-btn--outline" onClick={() => setDeleteTarget(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
