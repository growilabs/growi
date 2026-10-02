import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { assertOperationIds } from './assert-operation-ids';

/**
 * The generated spec is published to docs.growi.org and consumed by code
 * generators (orval, in `@growi/sdk-typescript`) that derive every symbol name
 * from `operationId`. A spec that loses those ids still validates as OpenAPI,
 * so nothing downstream rejects it — it just silently renames the whole
 * generated client (#11634).
 *
 * This assertion is the artifact-level guard: it runs on the finished file, so
 * it catches a generation step that exited successfully while doing nothing.
 */
async function writeSpec(spec: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'assert-operation-ids-'));
  const file = path.join(dir, 'openapi.json');
  await fs.writeFile(file, JSON.stringify(spec));
  return file;
}

const operation = (operationId?: string) => ({
  responses: { 200: { description: 'ok' } },
  ...(operationId != null ? { operationId } : {}),
});

describe('assertOperationIds', () => {
  it('accepts a spec whose every operation has an operationId', async () => {
    const file = await writeSpec({
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0.0' },
      paths: {
        '/page/exist': { get: operation('getExistForPage') },
        '/pages/delete': { post: operation('postDeleteForPages') },
      },
    });

    expect(() => assertOperationIds(file)).not.toThrow();
  });

  it('rejects a spec where every operationId is missing', async () => {
    const file = await writeSpec({
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0.0' },
      paths: {
        '/page/exist': { get: operation() },
        '/pages/delete': { post: operation() },
      },
    });

    expect(() => assertOperationIds(file)).toThrow(/operationId/);
  });

  it('rejects a spec where only some operationIds are missing', async () => {
    const file = await writeSpec({
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0.0' },
      paths: {
        '/page/exist': { get: operation('getExistForPage') },
        '/pages/delete': { post: operation() },
      },
    });

    expect(() => assertOperationIds(file)).toThrow(/POST \/pages\/delete/);
  });

  it('rejects a spec that declares no operations at all', async () => {
    const file = await writeSpec({
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0.0' },
      paths: {},
    });

    expect(() => assertOperationIds(file)).toThrow(/no operations/i);
  });

  it('ignores non-operation keys of a path item', async () => {
    const file = await writeSpec({
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0.0' },
      paths: {
        '/page/{pageId}': {
          parameters: [{ name: 'pageId', in: 'path', required: true }],
          summary: 'a path-level summary, not an operation',
          get: operation('getPageByPageId'),
        },
      },
    });

    expect(() => assertOperationIds(file)).not.toThrow();
  });

  it('rejects a file that is not readable as JSON', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'assert-operation-ids-'));
    const file = path.join(dir, 'openapi.json');
    await fs.writeFile(file, 'this is not valid json');

    expect(() => assertOperationIds(file)).toThrow();
  });
});
