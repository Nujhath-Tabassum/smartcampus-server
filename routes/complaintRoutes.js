import express from "express";
import multer from "multer";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db.js";
import { verifyAdmin } from "../middleware/verifyAdmin.js";
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
      .find(
        {
          studentEmail: req.user.email,
        },
        {
          projection: {
            image: 1,
            title: 1,
            category: 1,
            building: 1,
            room: 1,
            description: 1,
            priority: 1,
            status: 1,
            createdAt: 1,
          },
        }
      )
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

router.get("/admin/dashboard", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = getDB();

    const complaintsCollection = db.collection("complaints");

    const [
      total,
      pending,
      inProgress,
      resolved,
      totalStudents,
      totalStaff,
      recentComplaints,
    ] = await Promise.all([
      complaintsCollection.countDocuments(),

      complaintsCollection.countDocuments({
        status: "Pending",
      }),

      complaintsCollection.countDocuments({
        status: "In Progress",
      }),

      complaintsCollection.countDocuments({
        status: "Resolved",
      }),

      db.collection("users").countDocuments({
        role: "student",
      }),

      db.collection("users").countDocuments({
        role: "staff",
      }),

      complaintsCollection
        .find({})
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
        totalStudents,
        totalStaff,
      },
      recentComplaints,
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load admin dashboard.",
    });
  }
});

router.get("/admin/all", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const db = getDB();

    const { status, priority, search } = req.query;

    const filter = {};

    if (status && status !== "All") {
      filter.status = status;
    }

    if (priority && priority !== "All") {
      filter.priority = priority;
    }

    if (search) {
      const searchText = search.toString().trim();

      filter.$or = [
        { title: { $regex: searchText, $options: "i" } },
        { studentName: { $regex: searchText, $options: "i" } },
        { studentId: { $regex: searchText, $options: "i" } },
        { category: { $regex: searchText, $options: "i" } },
      ];
    }

    const complaints = await db
      .collection("complaints")
      .find(filter)
      .sort({ createdAt: -1 })
      .project({ image: 0 })
      .toArray();

    res.send({
      success: true,
      total: complaints.length,
      complaints,
    });
  } catch (error) {
    console.error("Admin complaints error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load complaints.",
    });
  }
});


router.get("/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid complaint ID.",
      });
    }

    const db = getDB();

    const complaint = await db.collection("complaints").findOne({
      _id: new ObjectId(id),
    });

    if (!complaint) {
      return res.status(404).send({
        success: false,
        message: "Complaint not found.",
      });
    }

    res.send({
      success: true,
      complaint,
    });
  } catch (error) {
    console.error("Admin complaint details error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load complaint details.",
    });
  }
});

router.patch(
  "/admin/:id/assign",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { staffId } = req.body;

      if (!ObjectId.isValid(id) || !ObjectId.isValid(staffId)) {
        return res.status(400).send({
          success: false,
          message: "Invalid complaint or staff ID.",
        });
      }

      const db = getDB();

      const staff = await db.collection("users").findOne(
        {
          _id: new ObjectId(staffId),
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

      const result = await db.collection("complaints").updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            assignedStaff: {
              _id: staff._id,
              name: staff.name,
              email: staff.email,
              department: staff.department,
            },
            assignedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          success: false,
          message: "Complaint not found.",
        });
      }

      res.send({
        success: true,
        message: "Duty assigned successfully.",
      });
    } catch (error) {
      console.error("Assign duty error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to assign duty.",
      });
    }
  }
);

router.patch("/admin/:id/status", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "Pending",
      "In Progress",
      "Resolved",
    ];

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid complaint ID.",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).send({
        success: false,
        message: "Invalid complaint status.",
      });
    }

    const db = getDB();

    const result = await db.collection("complaints").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Complaint not found.",
      });
    }

    res.send({
      success: true,
      message: "Complaint status updated successfully.",
    });
  } catch (error) {
    console.error("Admin status update error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update complaint status.",
    });
  }
});

router.get(
  "/admin/staff/:id/duties",
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

      const staff = await db.collection("users").findOne({
        _id: new ObjectId(id),
        role: "staff",
      });

      if (!staff) {
        return res.status(404).send({
          success: false,
          message: "Staff member not found.",
        });
      }

      const duties = await db
        .collection("complaints")
        .find({
          "assignedStaff._id": new ObjectId(id),
        })
        .project({ image: 0 })
        .sort({ assignedAt: -1 })
        .toArray();

      res.send({
        success: true,
        total: duties.length,
        duties,
      });
    } catch (error) {
      console.error("Staff duties error:", error);

      res.status(500).send({
        success: false,
        message: "Failed to load staff duties.",
      });
    }
  }
);

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
    console.error("Admin staff list error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load staff members.",
    });
  }
});

router.post("/admin/staff", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { name, email, department, phone, password } = req.body;

    if (!name || !email || !department || !password) {
      return res.status(400).send({
        success: false,
        message: "Please provide all required fields.",
      });
    }

    if (password.length < 6) {
      return res.status(400).send({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const db = getDB();
    const usersCollection = db.collection("users");

    const existingUser = await usersCollection.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingUser) {
      return res.status(409).send({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newStaff = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      department: department.trim(),
      phone: phone?.trim() || "",
      password: hashedPassword,
      role: "staff",
      verified: true,
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newStaff);

    res.status(201).send({
      success: true,
      message: "Staff account created successfully.",
      staff: {
        _id: result.insertedId,
        name: newStaff.name,
        email: newStaff.email,
        department: newStaff.department,
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



export default router;
