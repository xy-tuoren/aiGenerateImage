import { MongoClient } from 'mongodb';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error('请在 .env 文件中配置 MONGO_URI');
}

let mongoClient: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI as string, { maxPoolSize: 10 });
  }
  await mongoClient.connect();
  return mongoClient;
}

export async function getMongoDb(dbName: string) {
  if (!dbName) {
    throw new Error('请传入 dbName');
  }
  const client = await getMongoClient();
  return client.db(dbName);
}

export async function closeMongo(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
  }
}

