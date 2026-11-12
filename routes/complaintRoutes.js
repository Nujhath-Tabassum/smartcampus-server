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

    const complaints = await db.collection("complaints")
      .find({
        studentEmail: req.user.email,
      })
      .sort({ createdAt: -1 })
      .toArray();

    const formattedComplaints = complaints.map((complaint) => ({
      _id: complaint._id.toString(),
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

router.get("/dashboard", verifyToken, async (req, res) => {
  try {
    const db = getDB();

    const filter = {
      studentEmail: req.user.email,
    };

    const [
      total,
      pending,
      inProgress,
      resolved,
      recentComplaints,
    ] = await Promise.all([
      db.collection("complaints").countDocuments(filter),

      db.collection("complaints").countDocuments({
        ...filter,
        status: "Pending",
      }),

      db.collection("complaints").countDocuments({
        ...filter,
        status: "In Progress",
      }),

      db.collection("complaints").countDocuments({
        ...filter,
        status: "Resolved",
      }),

      db.collection("complaints")
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(5)
        .project({ image: 0 })
        .toArray(),
    ]);

    res.send({
      success: true,
      stats: {
        total,
        pending,
        inProgress,
        resolved,
      },
      recentComplaints,
    });
  } catch (error) {
    console.error("Dashboard error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load dashboard data.",
    });
  }
});

router.get("/:id", verifyToken, async (req, res) => {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid complaint ID.",
      });
    }

    const db = getDB();

    const complaint = await db.collection("complaints").findOne({
      _id: new ObjectId(req.params.id),
      studentEmail: req.user.email,
    });

    if (!complaint) {
      return res.status(404).send({
        success: false,
        message: "Complaint not found.",
      });
    }

    const imageUrl = complaint.image
      ? `data:${complaint.image.contentType};base64,${complaint.image.data.toString("base64")}`
      : null;

    const { image, ...complaintDetails } = complaint;

    res.send({
      success: true,
      complaint: {
        ...complaintDetails,
        imageUrl,
        hasImage: Boolean(image),
      },
    });
  } catch (error) {
    console.error("Complaint details error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch complaint details.",
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
      complaintId: result.insertedId.toString(),
    });
  } catch (error) {
    console.error("Complaint submission error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to submit complaint.",
    });
  }
});
router.patch("/:id", verifyToken, upload.single("image"), async (req, res) => {
  try {
    const { title, category, building, room, description, priority } = req.body;

    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid complaint ID.",
      });
    }

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

    const complaint = await db.collection("complaints").findOne({
      _id: new ObjectId(req.params.id),
      studentEmail: req.user.email,
    });

    if (!complaint) {
      return res.status(404).send({
        success: false,
        message: "Complaint not found.",
      });
    }

    if (complaint.status !== "Pending") {
      return res.status(403).send({
        success: false,
        message: "Only pending complaints can be edited.",
      });
    }

    const updatedData = {
      title: title.trim(),
      category,
      building: building.trim(),
      room: room?.trim() || "",
      description: description.trim(),
      priority,
      updatedAt: new Date(),
    };

    if (req.file) {
      updatedData.image = {
        data: req.file.buffer,
        contentType: req.file.mimetype,
      };
    }

    await db.collection("complaints").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updatedData }
    );

    res.send({
      success: true,
      message: "Complaint updated successfully.",
    });
  } catch (error) {
    console.error("Complaint update error:", error);
    res.status(500).send({
      success: false,
      message: "Failed to update complaint.",
    });
  }
});

router.delete("/:id", verifyToken, async (req, res) => {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid complaint ID.",
      });
    }

    const db = getDB();

    const result = await db.collection("complaints").deleteOne({
      _id: new ObjectId(req.params.id),
      studentEmail: req.user.email,
      status: "Pending",
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Complaint not found or cannot be deleted.",
      });
    }

    res.send({
      success: true,
      message: "Complaint deleted successfully.",
    });
  } catch (error) {
    console.error("Complaint deletion error:", error);
    res.status(500).send({
      success: false,
      message: "Failed to delete complaint.",
    });
  }
});

export default router;