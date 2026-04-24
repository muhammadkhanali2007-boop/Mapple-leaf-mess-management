const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Mess = require("../models/Mess");
const DailyReport = require("../models/DailyReport");

/**
 * Old deployments may still have a unique index on { userId, date } only.
 * That blocks a second document for the same day (dinner). Drop it; keep
 * { userId, date, mealType } from the schema.
 */
async function fixAttendanceUniqueIndex() {
  try {
    const coll = mongoose.connection.collection("attendances");
    const indexes = await coll.indexes();
    for (const idx of indexes) {
      if (!idx.key) continue;
      const k = idx.key;
      const names = Object.keys(k);
      if (
        idx.unique &&
        names.length === 2 &&
        k.userId === 1 &&
        k.date === 1 &&
        k.mealType == null
      ) {
        await coll.dropIndex(idx.name);
        console.log(`🗑 Dropped legacy attendance index (userId+date only): ${idx.name}`);
      }
    }
    await Attendance.syncIndexes();
  } catch (e) {
    console.warn("attendance index fix:", e.message);
  }
}

/**
 * Old Mess docs may have a unique index on { date } only. That allows only ONE
 * mess row per calendar day — dinner cannot be created (E11000). Drop it so
 * { date, mealType } unique (from schema) applies.
 */
async function fixMessUniqueIndex() {
  const collName = Mess.collection.collectionName;
  let indexes = [];
  try {
    const coll = mongoose.connection.collection(collName);
    indexes = await coll.indexes();
    const summary = indexes
      .filter((i) => i.name && i.name !== "_id_")
      .map((i) => `${i.name}=${JSON.stringify(i.key)}${i.unique ? ":unique" : ""}`);
    console.log(`[mess] index inspect (${collName}):`, summary.length ? summary.join(" | ") : "(none except _id)");

    for (const idx of indexes) {
      if (!idx.key || !idx.name || idx.name === "_id_") continue;
      const k = idx.key;
      const keyNames = Object.keys(k);
      const isLegacyDateOnlyUnique =
        idx.unique === true &&
        keyNames.length === 1 &&
        k.date === 1 &&
        k.mealType == null;

      if (!isLegacyDateOnlyUnique) continue;

      try {
        await coll.dropIndex(idx.name);
        console.log(`[mess] dropped legacy unique index on { date } only — name: ${idx.name}`);
      } catch (dropErr) {
        console.error(
          `[mess] dropIndex FAILED for name="${idx.name}": ${dropErr.message || dropErr}`
        );
        throw dropErr;
      }
    }

    try {
      await Mess.syncIndexes();
      console.log(`[mess] syncIndexes OK (expects unique { date:1, mealType:1 })`);
    } catch (syncErr) {
      console.error(
        `[mess] syncIndexes FAILED: ${syncErr.message || syncErr}`,
        syncErr.code != null ? `(code ${syncErr.code})` : ""
      );
      throw syncErr;
    }
  } catch (e) {
    console.error("[mess] index fix error:", e.message || e, e?.code != null ? `code=${e.code}` : "");
  }
}

/** Set missing mealType to "lunch" (legacy = lunch); safe idempotent. */
async function runMealTypeBootstrap() {
  try {
    const ar = await Attendance.updateMany({ mealType: { $exists: false } }, { $set: { mealType: "lunch" } });
    const mr = await Mess.updateMany({ mealType: { $exists: false } }, { $set: { mealType: "lunch" } });
    const dr = await DailyReport.updateMany({ mealType: { $exists: false } }, { $set: { mealType: "lunch" } });
    if (ar.modifiedCount > 0 || mr.modifiedCount > 0 || dr.modifiedCount > 0) {
      console.log(
        `📋 mealType bootstrap: attendance +${ar.modifiedCount} mess +${mr.modifiedCount} dailyReport +${dr.modifiedCount}`
      );
    }
  } catch (e) {
    console.warn("mealType bootstrap:", e.message);
  }
}

async function connectDB() {
  try {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("MONGODB_URI is not set in environment");
    }

    mongoose.set("strictQuery", true);

    console.log("🔄 Connecting to MongoDB...");

    await mongoose.connect(uri);

    console.log("✅ MongoDB connected successfully");

    await runMealTypeBootstrap();
    await fixAttendanceUniqueIndex();
    await fixMessUniqueIndex();

    return mongoose.connection;

  } catch (error) {
    console.log("❌ MongoDB connection failed:");
    console.log(error.message);
    process.exit(1);
  }
}

module.exports = { connectDB };