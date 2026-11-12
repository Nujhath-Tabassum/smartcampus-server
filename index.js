import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";

import { connectToMongoDB } from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import complaintRoutes from "./routes/complaintRoutes.js";

const app = express();

const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);

app.get("/", (req, res) => {
  res.send({
    message: "Smart Campus server is running",
  });
});

async function startServer() {
  await connectToMongoDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();