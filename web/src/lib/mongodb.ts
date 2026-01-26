import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName =process.env.MONGODB_DB;

if (!uri) {
  throw new Error("MongoDB 未配置：请设置环境变量 MONGO_URI（或 MONGODB_URI）");
}

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  if (!global.__mongoClientPromise) {
    const client = new MongoClient(uri, { maxPoolSize: 10 });
    global.__mongoClientPromise = client.connect();
  }
  clientPromise = global.__mongoClientPromise;
} else {
  const client = new MongoClient(uri, { maxPoolSize: 10 });
  clientPromise = client.connect();
}

export async function getMongoDb() {
  const client = await clientPromise;
  return client.db(dbName);
}

