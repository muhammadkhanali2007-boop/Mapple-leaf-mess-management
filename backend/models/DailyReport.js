const mongoose = require("mongoose");

/** Snapshot at assign cost time; one per day per mealType */
const dailyReportSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    mealType: { type: String, enum: ["lunch", "dinner"], default: "lunch" },
    menu: { type: String, default: "" },
    totalExpense: { type: Number, default: 0, min: 0 },
    presentCount: { type: Number, default: 0, min: 0 },
    costPerHead: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

dailyReportSchema.index({ date: 1, mealType: 1 }, { unique: true });

module.exports = mongoose.model("DailyReport", dailyReportSchema);
