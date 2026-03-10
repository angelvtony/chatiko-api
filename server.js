require('dotenv').config({ override: true });

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("./middleware/auth");

const app = express();

// ------------------
// User model
// ------------------
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

// ------------------
// Preference model
// ------------------
const preferenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    preference: { type: String, required: true }
  },
  { timestamps: true }
);

const Preference = mongoose.model("Preference", preferenceSchema);

// ------------------
// Middleware
// ------------------
app.use(cors());
app.use(express.json());

// ------------------
// MongoDB Connection
// ------------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chatiko";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// ------------------
// Routes
// ------------------
app.get("/", (req, res) => {
  res.send("Chatiko API running 🚀");
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || "secret", { expiresIn: "7d" });

    res.status(201).json({ message: "User registered successfully", token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid username or password" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid username or password" });

    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || "secret", { expiresIn: "7d" });

    res.status(200).json({ message: "Login successful", token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Protected route
app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: "You are authenticated", user: req.user });
});

// Save preferences
app.post("/api/preferences", authMiddleware, async (req, res) => {
  try {
    const { preference } = req.body;

    if (!preference) {
      return res.status(400).json({ message: "Preference is required" });
    }

    const savedPreference = await Preference.create({
      userId: req.user.id,
      preference
    });

    res.status(200).json({
      message: "Preference saved successfully",
      preference: savedPreference
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ------------------
// Start server
// ------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));