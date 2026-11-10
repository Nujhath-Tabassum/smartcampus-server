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