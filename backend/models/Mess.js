const mongoose = require("mongoose");

const ingredientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantityKg: { type: Number, required: true, min: 0 },
    pricePerKg: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const messSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    messName: { type: String, default: "", trim: true },
    ingredients: { type: [ingredientSchema], default: [] },
    totalExpense: { type: Number, default: 0, min: 0 },
    costPerHead: { type: Number, default: 0, min: 0 },
    assigned: { type: Boolean, default: false },
    presentCountAtAssign: { type: Number, default: 0 },
  },
  { timestamps: true }
);

messSchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model("Mess", messSchema);
