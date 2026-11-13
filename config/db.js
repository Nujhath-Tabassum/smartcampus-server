
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URL);

let db;

export async function connectToMongoDB() {
  try {
    await client.connect();

    db = client.db("smart_campus");

    await db.collection("users").createIndex(
      { email: 1 },
      { unique: true }
    );

    await db.collection("users").createIndex(
      { studentId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          studentId: { $type: "string" },
        },
      }
    );

    await db.collection("complaints").createIndex({
      studentEmail: 1,
      createdAt: -1,
    });

    await db.collection("emailVerifications").createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );

    console.log("MongoDB connected successfully");

    return db;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

export function getDB() {
  return db;
}
