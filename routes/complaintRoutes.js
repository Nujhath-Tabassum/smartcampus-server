import express from "express";
import multer from "multer";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { verifyToken } from "../middleware/verifyToken.js";

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG and PNG images are allowed."));
    }
  },
});

router.get("/my", verifyToken, async (req, res) => {
  try {
    const db = getDB();

    const complaints = await db
      .collection("complaints")
      .find({
        studentEmail: req.user.email,
      })
      .sort({ createdAt: -1 })
      .toArray();

    const formattedComplaints = complaints.map((complaint) => ({
      _id: complaint._id,
      title: complaint.title,
      category: complaint.category,
      building: complaint.building,
      room: complaint.room,
      description: complaint.description,
      priority: complaint.priority,
      status: complaint.status,
      createdAt: complaint.createdAt,
      hasImage: Boolean(complaint.image),
    }));

    res.send({
      success: true,
      complaints: formattedComplaints,
    });
  } catch (error) {
    console.error("Fetching complaints error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch complaints.",
    });
  }
});

router.post("/", verifyToken, upload.single("image"), async (req, res) => {
  try {
    const {
      title,
      category,
      building,
      room,
      description,
      priority,
    } = req.body;

    if (!title || !category || !building || !description) {
      return res.status(400).send({
        success: false,
        message: "Please fill in all required fields.",
      });
    }

    if (!["Low", "Medium", "High"].includes(priority)) {
      return res.status(400).send({
        success: false,
        message: "Invalid priority.",
      });
    }

    const db = getDB();

    const student = await db.collection("users").findOne({
      _id: new ObjectId(req.user.id),
      role: "student",
    });

    if (!student) {
      return res.status(404).send({
        success: false,
        message: "Student account not found.",
      });
    }

    const newComplaint = {
      studentId: student.studentId,
      studentName: student.name,
      studentEmail: student.email,

      title: title.trim(),
      category,
      building: building.trim(),
      room: room?.trim() || "",
      description: description.trim(),

      priority,
      status: "Pending",
      assignedStaff: null,

      image: req.file
        ? {
            data: req.file.buffer,
            contentType: req.file.mimetype,
          }
        : null,

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("complaints").insertOne(newComplaint);

    res.status(201).send({
      success: true,
      message: "Complaint submitted successfully.",
      complaintId: result.insertedId,
    });
  } catch (error) {
    console.error("Complaint submission error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to submit complaint.",
    });
  }
});

export default router;