const mongoose = require("mongoose");

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

    return mongoose.connection;

  } catch (error) {
    console.log("❌ MongoDB connection failed:");
    console.log(error.message);
    process.exit(1);
  }
}

module.exports = { connectDB };