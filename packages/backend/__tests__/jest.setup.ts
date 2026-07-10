/**
 * Global Jest setup for the backend test suite.
 *
 * Spins up an in-memory MongoDB once per test process and connects Mongoose to
 * it BEFORE any model module is required (the model files call
 * `mongoose.model(...)` at import time and read the active connection). The DB
 * URI is set on `process.env` so anything reading `config.database.url` lands on
 * the memory server too. Collections are cleared after every test for isolation.
 *
 * Tests that are pure (no DB) are unaffected — they simply never touch a model.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Give config a real https public URL so self-hosted image URLs
// (`${publicUrl}/api/images/file/...`) are accepted by the Property image-URL
// validator during tests (a bare localhost host can trip `validator.isURL`).
process.env.PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://api.homiio.test';

let mongoServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;
  process.env.DATABASE_URL = uri;
  await mongoose.connect(uri);
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});
