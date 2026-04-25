const mongoose = require("mongoose");

const templateIngredientSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    quantity: { type: String, default: "" },
    unitPrice: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const mealTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    normalizedName: { type: String, trim: true, required: true },
    ingredients: { type: [templateIngredientSchema], default: [] },
    version: { type: Number, default: 1, min: 1 },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

mealTemplateSchema.index({ normalizedName: 1, version: -1 });

module.exports = mongoose.model("MealTemplate", mealTemplateSchema);
