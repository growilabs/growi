// Ensures MongoDB Feature Compatibility Version matches the mongo image (8.2).
// Required when the mongo image is upgraded while existing data persists in the volume.
// https://www.mongodb.com/ja-jp/docs/upcoming/release-notes/8.2-upgrade-standalone/
//
// Run with Node's native TypeScript support (>= v22.6 with strip-types,
// enabled by default in v24+). Resolution base is pinned to apps/app/ so the
// mongodb driver installed there can be loaded without changing cwd.

import { createRequire } from 'node:module';

const require = createRequire('/workspace/growi/apps/app/');
const { MongoClient } = require('mongodb') as typeof import('mongodb');

const URI = 'mongodb://mongo:27017';
const TARGET_FCV = '8.2';
const MAX_RETRIES = 30;
const RETRY_INTERVAL_MS = 2000;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function waitForMongo(): Promise<void> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const client = new MongoClient(URI, { serverSelectionTimeoutMS: 2000 });
    try {
      await client.connect();
      await client.db('admin').command({ ping: 1 });
      return;
    }
    catch {
      await sleep(RETRY_INTERVAL_MS);
    }
    finally {
      await client.close().catch(() => {});
    }
  }
  throw new Error(`MongoDB at ${URI} did not become ready in time`);
}

async function ensureFcv(): Promise<void> {
  const client = new MongoClient(URI);
  await client.connect();
  try {
    const admin = client.db('admin');
    const result = await admin.command({
      getParameter: 1,
      featureCompatibilityVersion: 1,
    }) as { featureCompatibilityVersion: { version: string } };
    const version = result.featureCompatibilityVersion.version;
    if (version === TARGET_FCV) {
      console.log(`FCV already ${TARGET_FCV}`);
      return;
    }
    await admin.command({ setFeatureCompatibilityVersion: TARGET_FCV, confirm: true });
    console.log(`FCV upgraded: ${version} -> ${TARGET_FCV}`);
  }
  finally {
    await client.close();
  }
}

console.log('Waiting for MongoDB to be ready...');
await waitForMongo();
console.log(`Ensuring MongoDB featureCompatibilityVersion is ${TARGET_FCV}...`);
try {
  await ensureFcv();
}
catch (e) {
  console.error('FCV upgrade failed:', (e as Error).message);
}
