import fs from 'fs/promises';
import type { OpenAPI3 } from 'openapi-typescript';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { generateOperationIds } from './generate-operation-ids';

async function createTempOpenAPIFile(spec: OpenAPI3): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'openapi-test-'));
  const filePath = path.join(tempDir, 'openapi.json');
  await fs.writeFile(filePath, JSON.stringify(spec));
  return filePath;
}

async function cleanup(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    await fs.rmdir(path.dirname(filePath));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Cleanup failed:', err);
  }
}

describe('generateOperationIds', () => {
  it('should generate correct operationId for simple paths', async () => {
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/foo': {
          get: {},
          post: {},
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath);
      const parsed = JSON.parse(result);

      expect(parsed.paths['/foo'].get.operationId).toBe('getFoo');
      expect(parsed.paths['/foo'].post.operationId).toBe('postFoo');
    } finally {
      await cleanup(filePath);
    }
  });

  it('should generate correct operationId for paths with parameters', async () => {
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/foo/{id}': {
          get: {},
        },
        '/foo/{id}/bar/{page}': {
          get: {},
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath);
      const parsed = JSON.parse(result);

      expect(parsed.paths['/foo/{id}'].get.operationId).toBe('getFooById');
      expect(parsed.paths['/foo/{id}/bar/{page}'].get.operationId).toBe(
        'getBarByPageByIdForFoo',
      );
    } finally {
      await cleanup(filePath);
    }
  });

  it('should generate correct operationId for nested resources', async () => {
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/foo/bar': {
          get: {},
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath);
      const parsed = JSON.parse(result);

      expect(parsed.paths['/foo/bar'].get.operationId).toBe('getBarForFoo');
    } finally {
      await cleanup(filePath);
    }
  });

  it('should preserve existing operationId when overwriteExisting is false', async () => {
    const existingOperationId = 'existingOperation';
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/foo': {
          get: {
            operationId: existingOperationId,
          },
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath, {
        overwriteExisting: false,
      });
      const parsed = JSON.parse(result);

      expect(parsed.paths['/foo'].get.operationId).toBe(existingOperationId);
    } finally {
      await cleanup(filePath);
    }
  });

  it('should overwrite existing operationId when overwriteExisting is true', async () => {
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/foo': {
          get: {
            operationId: 'existingOperation',
          },
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath, {
        overwriteExisting: true,
      });
      const parsed = JSON.parse(result);

      expect(parsed.paths['/foo'].get.operationId).toBe('getFoo');
    } finally {
      await cleanup(filePath);
    }
  });

  it('should generate correct operationId for root path', async () => {
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/': {
          get: {},
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath);
      const parsed = JSON.parse(result);

      expect(parsed.paths['/'].get.operationId).toBe('getRoot');
    } finally {
      await cleanup(filePath);
    }
  });

  it('should generate operationId for all HTTP methods', async () => {
    const spec: OpenAPI3 = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/foo': {
          get: {},
          post: {},
          put: {},
          delete: {},
          patch: {},
          options: {},
          head: {},
          trace: {},
        },
      },
    };

    const filePath = await createTempOpenAPIFile(spec);
    try {
      const result = await generateOperationIds(filePath);
      const parsed = JSON.parse(result);

      expect(parsed.paths['/foo'].get.operationId).toBe('getFoo');
      expect(parsed.paths['/foo'].post.operationId).toBe('postFoo');
      expect(parsed.paths['/foo'].put.operationId).toBe('putFoo');
      expect(parsed.paths['/foo'].delete.operationId).toBe('deleteFoo');
      expect(parsed.paths['/foo'].patch.operationId).toBe('patchFoo');
      expect(parsed.paths['/foo'].options.operationId).toBe('optionsFoo');
      expect(parsed.paths['/foo'].head.operationId).toBe('headFoo');
      expect(parsed.paths['/foo'].trace.operationId).toBe('traceFoo');
    } finally {
      await cleanup(filePath);
    }
  });

  it('should throw error for non-existent file', async () => {
    await expect(
      generateOperationIds('non-existent-file.json'),
    ).rejects.toThrow();
  });
});
