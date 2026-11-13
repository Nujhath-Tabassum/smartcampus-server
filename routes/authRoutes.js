import express from "express";
import bcrypt from "bcryptjs";
import { getDB } from "../config/db.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middleware/verifyToken.js";
import { ObjectId } from "mongodb";
import {
  randomInt,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "crypto";
import { sendEmail } from "../utils/sendEmail.js";
import { OAuth2Client } from "google-auth-library";

const router = express.Router();

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "postmessage"
);

const createAuthToken = (user, rememberMe = false) => {
  return jwt.sign(
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
};

const setAuthCookie = (res, token, rememberMe = false) => {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: rememberMe
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000,
    path: "/",
  });
};

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
        success: false,
        message: "All fields are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).send({
        success: false,
        message: "Password must be at least 8 characters.",
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
        success: false,
        message: "Email or Student ID already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const otp = randomInt(100000, 1000000).toString();
    const otpSalt = randomBytes(16).toString("hex");

    const otpHash = createHash("sha256")
      .update(`${otp}:${otpSalt}`)
      .digest("hex");

    const verificationData = {
      name: name.trim(),
      studentId: normalizedStudentId,
      email: normalizedEmail,
      department: department.trim(),
      batch: batch.trim(),
      phone: phone.trim(),
      password: hashedPassword,
      otpHash,
      otpSalt,
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      createdAt: new Date(),
    };

    const verificationCollection = db.collection("emailVerifications");

    await verificationCollection.deleteMany({
      $or: [
        { email: normalizedEmail },
        { studentId: normalizedStudentId },
      ],
    });

    await verificationCollection.insertOne(verificationData);

    try {
      await sendEmail(
        normalizedEmail,
        "Smart Campus - Email Verification",
        `Hello ${name.trim()},

Your Smart Campus verification code is:

${otp}

This code will expire in 10 minutes.

If you did not request this verification, you can ignore this email.

Smart Campus Team`
      );
    } catch (emailError) {
      await verificationCollection.deleteOne({
        email: normalizedEmail,
      });

      throw emailError;
    }

    res.status(200).send({
      success: true,
      verificationRequired: true,
      message: "Verification code sent to your email.",
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).send({
      success: false,
      message: "Could not send verification email.",
    });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).send({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    if (!/^\d{6}$/.test(otp.toString())) {
      return res.status(400).send({
        success: false,
        message: "Enter a valid 6-digit verification code.",
      });
    }

    const db = getDB();
    const normalizedEmail = email.trim().toLowerCase();

    const verificationCollection = db.collection("emailVerifications");

    const verification = await verificationCollection.findOne({
      email: normalizedEmail,
    });

    if (!verification) {
      return res.status(404).send({
        success: false,
        message: "Verification request not found. Please register again.",
      });
    }

    if (verification.expiresAt < new Date()) {
      await verificationCollection.deleteOne({
        _id: verification._id,
      });

      return res.status(410).send({
        success: false,
        message: "Verification code expired. Please register again.",
      });
    }

    if (verification.attempts >= 5) {
      await verificationCollection.deleteOne({
        _id: verification._id,
      });

      return res.status(429).send({
        success: false,
        message: "Too many incorrect attempts. Please register again.",
      });
    }

    const submittedHash = createHash("sha256")
      .update(`${otp}:${verification.otpSalt}`)
      .digest("hex");

    const isValid = timingSafeEqual(
      Buffer.from(submittedHash, "hex"),
      Buffer.from(verification.otpHash, "hex")
    );

    if (!isValid) {
      const attempts = verification.attempts + 1;

      if (attempts >= 5) {
        await verificationCollection.deleteOne({
          _id: verification._id,
        });
      } else {
        await verificationCollection.updateOne(
          { _id: verification._id },
          { $set: { attempts } }
        );
      }

      return res.status(400).send({
        success: false,
        message:
          attempts >= 5
            ? "Too many incorrect attempts. Please register again."
            : `Incorrect verification code. ${5 - attempts} attempts remaining.`,
      });
    }

    const existingUser = await db.collection("users").findOne({
      $or: [
        { email: verification.email },
        { studentId: verification.studentId },
      ],
    });

    if (existingUser) {
      await verificationCollection.deleteOne({
        _id: verification._id,
      });

      return res.status(409).send({
        success: false,
        message: "Email or Student ID already exists.",
      });
    }

    const newStudent = {
      name: verification.name,
      studentId: verification.studentId,
      email: verification.email,
      department: verification.department,
      batch: verification.batch,
      phone: verification.phone,
      password: verification.password,
      role: "student",
      isVerified: true,
      createdAt: new Date(),
    };

    await db.collection("users").insertOne(newStudent);

    await verificationCollection.deleteOne({
      _id: verification._id,
    });

    res.status(201).send({
      success: true,
      message: "Email verified and student account created successfully.",
    });
  } catch (error) {
    console.error("Email verification error:", error);

    if (error.code === 11000) {
      return res.status(409).send({
        success: false,
        message: "Email or Student ID already exists.",
      });
    }

    res.status(500).send({
      success: false,
      message: "Email verification failed.",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { identifier, password, rememberMe, selectedRole } = req.body;

if (!["student", "staff", "admin"].includes(selectedRole)) {
  return res.status(400).send({
    success: false,
    message: "Please select a valid role.",
  });
}

    if (!identifier || !password) {
      return res.status(400).send({
        success: false,
        message: "Email/Student ID and password are required.",
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
        success: false,
        message: "Invalid email, Student ID or password.",
      });
    }

    if (user.isVerified === false) {
      return res.status(403).send({
        success: false,
        message: "Please verify your email before logging in.",
      });
    }

    if (!user.password) {
      return res.status(401).send({
        success: false,
        message: "This account uses Google Sign-In. Please continue with Google.",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordCorrect) {
      return res.status(401).send({
        success: false,
        message: "Invalid email, Student ID or password.",
      });
    }
if (user.role !== selectedRole) {
  return res.status(403).send({
    success: false,
    message: `This account is not registered as ${selectedRole}.`,
  });
}
    const token = createAuthToken(user, rememberMe);

    setAuthCookie(res, token, rememberMe);

    res.status(200).send({
      success: true,
      message: "Login successful.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).send({
      success: false,
      message: "Internal server error.",
    });
  }
});

router.post("/google", async (req, res) => {
  try {
    const { code, rememberMe, selectedRole } = req.body;

    if (!["student", "staff", "admin"].includes(selectedRole)) {
      return res.status(400).send({
        success: false,
        message: "Please select a valid role.",
      });
    }

    if (!code) {
      return res.status(400).send({
        success: false,
        message: "Google authorization code is required.",
      });
    }

    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET
    ) {
      return res.status(500).send({
        success: false,
        message: "Google authentication is not configured on the server.",
      });
    }

    const { tokens } = await googleClient.getToken(code);

    if (!tokens.id_token) {
      return res.status(401).send({
        success: false,
        message: "Could not verify Google account.",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.email || payload.email_verified !== true) {
      return res.status(401).send({
        success: false,
        message: "Google account email is not verified.",
      });
    }

    const email = payload.email.toLowerCase();
    const db = getDB();

    const existingUser = await db.collection("users").findOne({
      email,
    });

    if (existingUser) {
      if (existingUser.role !== selectedRole) {
        return res.status(403).send({
          success: false,
          message: `This Google account is not registered as ${selectedRole}.`,
        });
      }

      const token = createAuthToken(existingUser, rememberMe);

      setAuthCookie(res, token, rememberMe);

      return res.status(200).send({
        success: true,
        newUser: false,
        message: "Google sign-in successful.",
        user: {
          id: existingUser._id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
        },
      });
    }

    if (selectedRole !== "student") {
      return res.status(403).send({
        success: false,
        message: "New Google accounts can only register as students.",
      });
    }

    const googleSignupToken = jwt.sign(
      {
        email,
        name: payload.name || "",
        picture: payload.picture || "",
        purpose: "google-signup",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "10m",
      }
    );

    res.status(200).send({
      success: true,
      newUser: true,
      message: "Complete your student information to create an account.",
      googleSignupToken,
      googleUser: {
        name: payload.name || "",
        email,
        picture: payload.picture || "",
      },
    });
  } catch (error) {
    console.error("Google authentication error:", error);

    res.status(401).send({
      success: false,
      message: "Google authentication failed. Please try again.",
    });
  }
});

router.post("/google-register", async (req, res) => {
  try {
    const {
      googleSignupToken,
      studentId,
      department,
      batch,
      phone,
      password,
    } = req.body;

    if (
      !googleSignupToken ||
      !studentId ||
      !department ||
      !batch ||
      !phone ||
      typeof password !== "string"
    ) {
      return res.status(400).send({
        success: false,
        message: "All student information fields are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).send({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    let googleData;

    try {
      googleData = jwt.verify(
        googleSignupToken,
        process.env.JWT_SECRET
      );
    } catch {
      return res.status(401).send({
        success: false,
        message: "Google registration session expired. Please try again.",
      });
    }

    if (
      googleData.purpose !== "google-signup" ||
      !googleData.email
    ) {
      return res.status(401).send({
        success: false,
        message: "Invalid Google registration session.",
      });
    }

    const db = getDB();

    const normalizedStudentId = studentId.trim();
    const normalizedEmail = googleData.email.toLowerCase();

    const existingUser = await db.collection("users").findOne({
      $or: [
        { email: normalizedEmail },
        { studentId: normalizedStudentId },
      ],
    });

    if (existingUser) {
      return res.status(409).send({
        success: false,
        message: "Email or Student ID already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newStudent = {
      name: googleData.name,
      studentId: normalizedStudentId,
      email: normalizedEmail,
      department: department.trim(),
      batch: batch.trim(),
      phone: phone.trim(),
      picture: googleData.picture || "",
      password: hashedPassword,
      role: "student",
      isVerified: true,
      authProvider: "google",
      createdAt: new Date(),
    };

    const result = await db.collection("users").insertOne(newStudent);

    const createdUser = {
      ...newStudent,
      _id: result.insertedId,
    };

    const token = createAuthToken(createdUser);

    setAuthCookie(res, token);

    res.status(201).send({
      success: true,
      message: "Google student account created successfully.",
      user: {
        id: result.insertedId,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role,
      },
    });
  } catch (error) {
    console.error("Google registration error:", error);

    if (error.code === 11000) {
      return res.status(409).send({
        success: false,
        message: "Email or Student ID already exists.",
      });
    }

    res.status(500).send({
      success: false,
      message: "Google registration failed.",
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
        success: false,
        message: "User not found.",
      });
    }

    res.send({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Fetching user error:", error);

    res.status(500).send({
      success: false,
      message: "Could not get user information.",
    });
  }
});

router.post("/admin/set-password", verifyToken, async (req, res) => {
  try {
    const { password } = req.body;

    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).send({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    if (!ObjectId.isValid(req.user.id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const db = getDB();

    const admin = await db.collection("users").findOne({
      _id: new ObjectId(req.user.id),
      role: "admin",
    });

    if (!admin) {
      return res.status(403).send({
        success: false,
        message: "Only administrators can set this password.",
      });
    }

    if (admin.password) {
      return res.status(409).send({
        success: false,
        message: "A password is already set for this account.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.collection("users").updateOne(
      {
        _id: admin._id,
        role: "admin",
        password: { $exists: false },
      },
      {
        $set: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount !== 1) {
      return res.status(409).send({
        success: false,
        message: "Password could not be set. Please try again.",
      });
    }

    res.send({
      success: true,
      message: "Admin password set successfully.",
    });
  } catch (error) {
    console.error("Admin password setup error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to set admin password.",
    });
  }
});

router.patch("/profile", verifyToken, async (req, res) => {
  try {
    const { name, department, batch, phone } = req.body;

    if (
      typeof name !== "string" ||
      typeof department !== "string" ||
      typeof batch !== "string" ||
      typeof phone !== "string" ||
      !name.trim() ||
      !department.trim() ||
      !batch.trim() ||
      !phone.trim()
    ) {
      return res.status(400).send({
        success: false,
        message: "All profile fields are required.",
      });
    }

    if (!ObjectId.isValid(req.user.id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid user ID.",
      });
    }

    const db = getDB();

    const result = await db.collection("users").updateOne(
      {
        _id: new ObjectId(req.user.id),
        role: "student",
      },
      {
        $set: {
          name: name.trim(),
          department: department.trim(),
          batch: batch.trim(),
          phone: phone.trim(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Student account not found.",
      });
    }

    const updatedUser = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );

    res.send({
      success: true,
      message: "Profile updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Profile update error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update profile.",
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
    message: "Logged out successfully.",
  });
});

router.get("/admin/students", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = getDB();
    const { search, department } = req.query;

    const filter = {
      role: "student",
    };

    if (department && department !== "All") {
      filter.department = department;
    }

    if (search) {
      const searchText = search.toString().trim();

      filter.$or = [
        { name: { $regex: searchText, $options: "i" } },
        { email: { $regex: searchText, $options: "i" } },
        { studentId: { $regex: searchText, $options: "i" } },
      ];
    }

    const students = await db
      .collection("users")
      .find(filter)
      .project({ password: 0 })
      .sort({ name: 1 })
      .toArray();

    res.send({
      success: true,
      total: students.length,
      students,
    });
  } catch (error) {
    console.error("Admin students error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load students.",
    });
  }
});

router.get("/admin/students/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid student ID.",
      });
    }

    const db = getDB();

    const student = await db.collection("users").findOne(
      {
        _id: new ObjectId(id),
        role: "student",
      },
      {
        projection: {
          password: 0,
        },
      }
    );

    if (!student) {
      return res.status(404).send({
        success: false,
        message: "Student not found.",
      });
    }

    res.send({
      success: true,
      student,
    });
  } catch (error) {
    console.error("Admin student details error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load student details.",
    });
  }
});

router.get("/admin/staff", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = getDB();

    const staff = await db
      .collection("users")
      .find({ role: "staff" })
      .project({ password: 0 })
      .sort({ name: 1 })
      .toArray();

    res.send({
      success: true,
      total: staff.length,
      staff,
    });
  } catch (error) {
    console.error("Admin staff error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load staff.",
    });
  }
});

router.post("/admin/staff", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).send({
        success: false,
        message: "Please provide all required fields.",
      });
    }

    const db = getDB();

    const normalizedEmail = email.toLowerCase().trim();

    const existingStaff = await db.collection("users").findOne({
      email: normalizedEmail,
    });

    if (existingStaff) {
      return res.status(409).send({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newStaff = {
      name: name.trim(),
      email: normalizedEmail,
      phone: phone || "",
      password: hashedPassword,
      role: "staff",
      createdAt: new Date(),
    };

    const result = await db.collection("users").insertOne(newStaff);

    res.status(201).send({
      success: true,
      message: "Staff account created successfully.",
      staff: {
        _id: result.insertedId,
        name: newStaff.name,
        email: newStaff.email,
        phone: newStaff.phone,
        role: newStaff.role,
      },
    });
  } catch (error) {
    console.error("Create staff error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to create staff account.",
    });
  }
});

router.get(
  "/admin/staff/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          success: false,
          message: "Invalid staff ID.",
        });
      }

      const db = getDB();

      const staff = await db.collection("users").findOne(
        {
          _id: new ObjectId(id),
          role: "staff",
        },
        {
          projection: { password: 0 },
        }
      );

      if (!staff) {
        return res.status(404).send({
          success: false,
          message: "Staff member not found.",
        });
      }

      res.send({
        success: true,
        staff,
      });
    } catch (error) {
      console.error("Staff details error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to load staff details.",
      });
    }
  }
);



export default router;