import express from "express";
import bcrypt from "bcryptjs";
import { getDB } from "../config/db.js";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middleware/verifyToken.js";
import { ObjectId } from "mongodb";

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const {
      name,
      studentId,
      email,
      department,
      batch,
      phone,
      password,
    } = req.body;

    if (
      !name ||
      !studentId ||
      !email ||
      !department ||
      !batch ||
      !phone ||
      !password
    ) {
      return res.status(400).send({
        message: "All fields are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).send({
        message: "Password must be at least 8 characters",
      });
    }

    const db = getDB();

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedStudentId = studentId.trim();

    const existingUser = await db.collection("users").findOne({
      $or: [
        { email: normalizedEmail },
        { studentId: normalizedStudentId },
      ],
    });

    if (existingUser) {
      return res.status(409).send({
        message: "Email or Student ID already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newStudent = {
      name: name.trim(),
      studentId: normalizedStudentId,
      email: normalizedEmail,
      department,
      batch,
      phone: phone.trim(),
      password: hashedPassword,
      role: "student",
      createdAt: new Date(),
    };

    await db.collection("users").insertOne(newStudent);

    res.status(201).send({
      success: true,
      message: "Student registered successfully",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send({
        message: "Email or Student ID already exists",
      });
    }

    console.error(error);

    res.status(500).send({
      message: "Internal server error",
    });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { identifier, password, rememberMe } = req.body;

    if (!identifier || !password) {
      return res.status(400).send({
        message: "Email/Student ID and password are required",
      });
    }

    const db = getDB();

    const value = identifier.trim();

    const user = await db.collection("users").findOne({
      $or: [
        { email: value.toLowerCase() },
        { studentId: value },
      ],
    });

    if (!user) {
      return res.status(401).send({
        message: "Invalid email, Student ID or password",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).send({
        message: "Invalid email, Student ID or password",
      });
    }

    const token = jwt.sign(
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: rememberMe ? "7d" : "1d",
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: rememberMe
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(200).send({
      success: true,
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Internal server error",
    });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { identifier, password, rememberMe } = req.body;

    if (!identifier || !password) {
      return res.status(400).send({
        message: "Email/Student ID and password are required",
      });
    }

    const db = getDB();

    const value = identifier.trim();

    const user = await db.collection("users").findOne({
      $or: [
        { email: value.toLowerCase() },
        { studentId: value },
      ],
    });

    if (!user) {
      return res.status(401).send({
        message: "Invalid email, Student ID or password",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).send({
        message: "Invalid email, Student ID or password",
      });
    }

    const token = jwt.sign(
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: rememberMe ? "7d" : "1d",
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: rememberMe
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.status(200).send({
      success: true,
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Internal server error",
    });
  }
});
router.get("/me", verifyToken, async (req, res) => {
  try {
    const db = getDB();

    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).send({
        message: "User not found",
      });
    }

    res.send({
      success: true,
      user,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Could not get user information",
    });
  }
});
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  res.send({
    success: true,
    message: "Logged out successfully",
  });
});

export default router;