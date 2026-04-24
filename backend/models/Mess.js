const mongoose = require("mongoose");

/** Line item: price = row total (Rs). Legacy docs may still have quantityKg / pricePerKg / total. */
const ingredientSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    quantity: { type: String, default: "" },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: true, strict: false }
);

const messSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    mealType: { type: String, enum: ["lunch", "dinner"], default: "lunch" },
    messName: { type: String, default: "", trim: true },
    ingredients: { type: [ingredientSchema], default: [] },
    totalCost: { type: Number, default: 0, min: 0 },
    totalExpense: { type: Number, default: 0, min: 0 },
    costPerHead: { type: Number, default: 0, min: 0 },
    assigned: { type: Boolean, default: false },
    presentCountAtAssign: { type: Number, default: 0 },
    isFinalized: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messSchema.index({ date: 1, mealType: 1 }, { unique: true });

module.exports = mongoose.model("Mess", messSchema);
