const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ["Present", "Absent"], required: true },
    mealType: { type: String, enum: ["lunch", "dinner"], default: "lunch" },
    /** Set when admin finalizes mess cost for this meal; Present = per-head share, Absent = 0 (omit before assign) */
    cost: { type: Number, min: 0 },
  },
  { timestamps: true }
);

attendanceSchema.index({ userId: 1, date: 1, mealType: 1 }, { unique: true });
attendanceSchema.index({ date: -1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
