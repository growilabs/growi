import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { SessionConfig } from '~/interfaces/session-config';
import type Crowi from '~/server/crowi';
import { resolveFromRoot } from '~/server/util/project-dir-utils';

import { setup as setupExpressInit } from './express-init';
import { createSessionIdGenerator, FIXED_SESSION_ID_PATHS } from './session-id';

const SESSION_COLLECTION = 'sessions_express_init_integ';
const SESSION_COOKIE = /connect\.sid=/;

// A build asset of this test's own, next to the real ones.
const ASSET_DIR = 'express-init-integ';
const assetDirPath = resolveFromRoot(path.join('.next/static', ASSET_DIR));

describe('express-init', () => {
  const crowi = mock<Crowi>({}, { deep: true });
  let app: Express;

  beforeAll(async () => {
    fs.mkdirSync(assetDirPath, { recursive: true });
    fs.writeFileSync(path.join(assetDirPath, 'main.js'), '// build asset');

    const { default: MongoStore } = await import('connect-mongo');
    const sessionConfig: SessionConfig = {
      rolling: true,
      secret: 'express-init-integ-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 60_000 },
      genid: createSessionIdGenerator(FIXED_SESSION_ID_PATHS),
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: SESSION_COLLECTION,
      }),
    };
    // A deep mock types every field as a mock, so plain values go in via assign.
    Object.assign(crowi, {
      node_env: 'test',
      publicDir: os.tmpdir(),
      sessionConfig,
    });

    app = express();
    setupExpressInit(crowi, app);

    // Stands in for server/routes/index.js, which hands /_next/* to Next.js
    // after the session.
    app.get('/_next/*', (_req, res) => {
      res.status(404).end('answered by Next.js');
    });
    app.get('/a-page', (_req, res) => {
      res.end('a page');
    });
  });

  afterAll(async () => {
    fs.rmSync(assetDirPath, { recursive: true, force: true });
    await mongoose.connection.collection(SESSION_COLLECTION).drop();
  });

  it('sends the session cookie with a page', async () => {
    const res = await request(app).get('/a-page');

    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(SESSION_COOKIE);
  });

  // A response that re-sends the cookie can arrive after a login has replaced
  // the session, and puts the browser back on the old one.
  it('serves a Next.js build asset without the session cookie', async () => {
    const res = await request(app).get(`/_next/static/${ASSET_DIR}/main.js`);

    expect(res.status).toBe(200);
    expect(res.text).toBe('// build asset');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('leaves a build asset that is not on disk to Next.js, behind the session', async () => {
    const res = await request(app).get(`/_next/static/${ASSET_DIR}/missing.js`);

    expect(res.text).toBe('answered by Next.js');
    expect(String(res.headers['set-cookie'])).toMatch(SESSION_COOKIE);
  });
});
