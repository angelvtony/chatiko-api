const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true
    },
    password: {
      type: String,
      required: true
    },
    latitude: Number,      // new
    longitude: Number,     // new
    isOnline: { type: Boolean, default: false }, // new
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);

// ------------------
// Preference model
// ------------------
const preferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    preference: String
  },
  { timestamps: true }
  );
  
  const Preference = mongoose.model("Preference", preferenceSchema);