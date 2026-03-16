require('dotenv').config({ override: true });

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("./middleware/auth"); // your auth middleware
const debug = require('debug')('chatiko:app'); 

const app = express();

// ------------------
// Models
// ------------------

// User model
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    isOnline: { type: Boolean, default: false }
  },
  { timestamps: true }
);
const User = mongoose.model("User", userSchema);

// Preference model
const preferenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    preference: { type: String, required: true }
  },
  { timestamps: true }
);
const Preference = mongoose.model("Preference", preferenceSchema);

// Message model
const messageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true },
    reaction: { type: String, default: null}
  },
  { timestamps: true }
);
const Message = mongoose.model("Message", messageSchema);

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
// HTTP Server + Socket.IO
// ------------------
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// ------------------
// Socket.IO Chat Logic
// ------------------
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  // Join user room
  socket.on("join", (userId) => {
    socket.join(userId);
    console.log("User joined room:", userId);
  });

  // Send message
  socket.on("sendMessage", async (data) => {
    try {
      const { senderId, receiverId, message } = data;
  
      // Always include reaction as null
      const savedMessage = await Message.create({
        senderId,
        receiverId,
        message,
        reaction: null
      });
  
      // Emit the message to both users
      io.to(receiverId).emit("receiveMessage", savedMessage);
      io.to(senderId).emit("receiveMessage", savedMessage);
  
    } catch (err) {
      console.error("sendMessage error:", err);
    }
  });

  socket.on("reactMessage", async (data) => {
    console.log("Reaction received:", data);
    try {
      const { messageId, reaction, senderId, receiverId } = data;
  
      // Update reaction and return the updated document
      const updatedMessage = await Message.findByIdAndUpdate(
        messageId,
        { reaction },
        { returnDocument: 'after' }  // <-- use recommended option
      );
  
      if (updatedMessage) {
        // Emit updated message to both sender and receiver
        io.to(senderId).emit("messageReaction", updatedMessage);
        io.to(receiverId).emit("messageReaction", updatedMessage);
        console.log("Updated message:", updatedMessage);
      }
  
    } catch (err) {
      console.error("reactMessage error:", err);
    }
  });

  // Delete message
  socket.on("deleteMessage", async (data) => {
    try {
      const { messageId, senderId, receiverId } = data;
  
      console.log("Deleting message:", messageId);
  
      await Message.findByIdAndDelete(messageId);
  
      io.to(senderId).emit("messageDeleted", { messageId });
      io.to(receiverId).emit("messageDeleted", { messageId });
  
    } catch (err) {
      console.error("deleteMessage error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

// ------------------
// Routes
// ------------------
app.get("/", (req, res) => {
  res.send("Chatiko API running 🚀");
});

// Signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, email, password, latitude, longitude } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      email,
      password: hashedPassword,
      latitude: latitude || null,
      longitude: longitude || null,
      isOnline: !!(latitude && longitude)
    });

    await user.save();

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    res.status(201).json({ message: "User registered successfully", token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid username or password" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid username or password" });

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

    res.status(200).json({ message: "Login successful", token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Protected route
app.get("/api/protected", authMiddleware, (req, res) => {
  res.json({ message: "You are authenticated", user: req.user });
});

// Save/update preferences
app.post("/api/preferences", authMiddleware, async (req, res) => {
  try {
    const { preference } = req.body;

    if (!preference) return res.status(400).json({ message: "Preference is required" });

    const savedPreference = await Preference.findOneAndUpdate(
      { userId: req.user.id },
      { preference },
      { new: true, upsert: true }
    );

    res.status(200).json({ message: "Preference saved successfully", preference: savedPreference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Update user location
app.post("/api/users/:id/location", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: "Latitude and longitude are required" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { latitude, longitude, isOnline: true },
      { new: true, runValidators: true }
    );

    res.json({ message: "Location updated", user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get nearby users
app.get("/api/users/nearby", authMiddleware, async (req, res) => {
  try {
    const { latitude, longitude, radius = 1000 } = req.query;

    if (!latitude || !longitude) return res.status(400).json({ message: "Latitude and longitude required" });

    const users = await User.find({ latitude: { $exists: true }, longitude: { $exists: true }, isOnline: true });

    const nearby = [];
    const toRad = x => x * Math.PI / 180;
    const R = 6371000; // Earth radius in meters
    const userLat = parseFloat(latitude);
    const userLng = parseFloat(longitude);

    for (const user of users) {
      const dLat = toRad(user.latitude - userLat);
      const dLon = toRad(user.longitude - userLng);
      const lat1 = toRad(userLat);
      const lat2 = toRad(user.latitude);

      const a = Math.sin(dLat / 2) ** 2 +
                Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;

      if (distance <= radius) {
        const pref = await Preference.findOne({ userId: user._id });

        nearby.push({
          id: user._id,
          username: user.username,
          latitude: user.latitude,
          longitude: user.longitude,
          isOnline: user.isOnline,
          mood: pref?.preference || "Normal"
        });
      }
    }

    res.json(nearby);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get chat messages between two users
app.get("/api/messages/:userId", authMiddleware, async (req, res) => {
  try {
    const currentUser = req.user.id;
    const otherUser = req.params.userId;

    const messages = await Message.find({
      $or: [
        { senderId: currentUser, receiverId: otherUser },
        { senderId: otherUser, receiverId: currentUser }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Save user public key
app.post("/api/users/publicKey", authMiddleware, async (req,res)=>{

  try{
 
   const userId = req.user.id
   const { publicKey } = req.body
 
   await User.findByIdAndUpdate(
     userId,
     { publicKey }
   )
 
   res.json({ message:"Public key saved" })
 
  }catch(err){
 
   res.status(500).json({ error:err.message })
 
  }
 
 })


// Get user public key
app.get("/api/users/:id/publicKey", authMiddleware, async (req,res)=>{

  try{
 
   const user = await User.findById(req.params.id)
 
   if(!user){
    return res.status(404).json({message:"User not found"})
   }
 
   res.json({
     publicKey:user.publicKey
   })
 
  }catch(err){
   res.status(500).json({error:err.message})
  }
 
 })

// ------------------
// Start Server
// ------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});