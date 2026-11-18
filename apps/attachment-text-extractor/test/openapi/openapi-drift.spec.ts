import { openApiDrift } from '../../scripts/check-openapi-drift';

// Req 7.3: the comparison the drift check runs between the document the
// service writes and the committed client document (research.md 17.7 1,
// 17.13). A full JSON comparison: object keys in any order, arrays in order,
// every difference reported as a JSON Pointer. The committed document is the
// Python one until 8.2, so the Node document is not compared with it here.
// Python test_smoke_extract.py TestOpenapiDrift (check_openapi_drift.py).

const document = () => ({
  openapi: '3.1.0',
  info: { title: 'Extractor', version: '1.0.0' },
  paths: {
    '/extract': {
      post: {
        operationId: 'postExtract',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/healthz': { get: { operationId: 'getHealthz' } },
  },
  components: {
    schemas: {
      ExtractResponse: {
        type: 'object',
        required: ['pages', 'mimeType', 'extractedCharacters'],
        description: 'The answer of POST /extract',
      },
    },
  },
});

/** The same JSON with every object's keys in reverse order. */
const reordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reordered);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reordered(item)]),
  );
};

describe('openApiDrift', () => {
  it('finds nothing between equal documents whose keys are in another order', () => {
    expect(openApiDrift(reordered(document()), document())).toEqual([]);
  });

  it('reports a changed value at its JSON Pointer, escaping "/" in keys', () => {
    const base = document();
    const changed = {
      ...base,
      paths: {
        ...base.paths,
        '/extract': {
          post: { ...base.paths['/extract'].post, operationId: 'extract' },
        },
      },
    };

    expect(openApiDrift(changed, base)).toEqual([
      '/paths/~1extract/post/operationId',
    ]);
  });

  it('reports a changed description like any other value', () => {
    const base = document();
    const schema = base.components.schemas.ExtractResponse;
    const changed = {
      ...base,
      components: {
        schemas: {
          ExtractResponse: { ...schema, description: 'rewritten' },
        },
      },
    };

    expect(openApiDrift(changed, base)).toEqual([
      '/components/schemas/ExtractResponse/description',
    ]);
  });

  it('reports a key only one side has, in both directions', () => {
    const base = document();
    const { '/healthz': _removed, ...withoutHealthz } = base.paths;
    const withReadyz = {
      ...base,
      paths: { ...base.paths, '/readyz': { get: {} } },
    };

    expect(openApiDrift({ ...base, paths: withoutHealthz }, base)).toEqual([
      '/paths/~1healthz',
    ]);
    expect(openApiDrift(withReadyz, base)).toEqual(['/paths/~1readyz']);
  });

  it('compares arrays in order', () => {
    const base = document();
    const swapped = {
      ...base,
      components: {
        schemas: {
          ExtractResponse: {
            ...base.components.schemas.ExtractResponse,
            required: ['mimeType', 'pages', 'extractedCharacters'],
          },
        },
      },
    };

    expect(openApiDrift(swapped, base)).toEqual([
      '/components/schemas/ExtractResponse/required/0',
      '/components/schemas/ExtractResponse/required/1',
    ]);
  });

  it('reports an array of another length at the array itself', () => {
    const base = document();
    const longer = {
      ...base,
      components: {
        schemas: {
          ExtractResponse: {
            ...base.components.schemas.ExtractResponse,
            required: ['pages', 'mimeType', 'extractedCharacters', 'engine'],
          },
        },
      },
    };

    expect(openApiDrift(longer, base)).toEqual([
      '/components/schemas/ExtractResponse/required',
    ]);
  });

  it('tells a value from a value of another type (null, number, string, object)', () => {
    expect(openApiDrift({ a: null }, { a: {} })).toEqual(['/a']);
    expect(openApiDrift({ a: 1 }, { a: '1' })).toEqual(['/a']);
    expect(openApiDrift({ a: [] }, { a: {} })).toEqual(['/a']);
    expect(openApiDrift([1], { 0: 1 })).toEqual(['']);
  });
});
