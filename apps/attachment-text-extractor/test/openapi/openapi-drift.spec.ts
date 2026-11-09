import { openApiDrift } from '../../scripts/check-openapi-drift';
import { openApiDocument } from '../../src/http/openapi-route';
import { recordOf } from '../../src/http/spec-support/extract-client';
import { readCommittedOpenApi } from './openapi-support';

// Req 7.3: the drift check between the service's document and the committed
// client document (research.md 17.7 1). Object keys compare in any order,
// arrays in order; until 8.2 the annotation `description`s are left out, but a
// property that is itself named "description" is not (17.3 2). Python
// test_smoke_extract.py TestOpenapiDrift (check_openapi_drift.py).

const clone = (value: unknown): Record<string, unknown> =>
  recordOf(JSON.parse(JSON.stringify(value)));

/** Sets `value` at `path` in a JSON copy (undefined removes the key). */
const withValue = (
  doc: unknown,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> => {
  const copy = clone(doc);
  let node: unknown = copy;
  for (const key of path.slice(0, -1)) {
    if (typeof node !== 'object' || node === null) throw new Error(`no ${key}`);
    node = Reflect.get(node, key);
  }
  if (typeof node !== 'object' || node === null) throw new Error('no parent');
  const last = path.at(-1) ?? '';
  if (value === undefined) Reflect.deleteProperty(node, last);
  else Reflect.set(node, last, value);
  return copy;
};

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
  const committed = readCommittedOpenApi();

  it('the service document does not drift from the committed client document', () => {
    expect(openApiDrift(openApiDocument, committed)).toEqual([]);
  });

  it('finds no drift in a copy with its keys reordered', () => {
    expect(openApiDrift(reordered(committed), committed)).toEqual([]);
  });

  it('ignores a changed annotation description', () => {
    const changed = withValue(
      committed,
      ['paths', '/readyz', 'get', 'description'],
      'rewritten',
    );

    expect(openApiDrift(changed, committed)).toEqual([]);
  });

  it('reports a changed title with its JSON pointer', () => {
    const changed = withValue(
      committed,
      [
        'components',
        'schemas',
        'PageInfo',
        'properties',
        'pageNumber',
        'title',
      ],
      'PageNumber',
    );

    expect(openApiDrift(changed, committed)).toEqual([
      '/components/schemas/PageInfo/properties/pageNumber/title',
    ]);
  });

  it('reports a changed operationId and a removed path', () => {
    const changed = withValue(
      committed,
      ['paths', '/extract', 'post', 'operationId'],
      'postExtract',
    );
    const removed = withValue(committed, ['paths', '/healthz'], undefined);

    expect(openApiDrift(changed, committed)).toEqual([
      '/paths/~1extract/post/operationId',
    ]);
    expect(openApiDrift(removed, committed)).toEqual(['/paths/~1healthz']);
  });

  it('compares arrays in order', () => {
    const swapped = withValue(
      committed,
      ['components', 'schemas', 'ExtractResponse', 'required'],
      ['mimeType', 'pages', 'extractedCharacters'],
    );

    expect(openApiDrift(swapped, committed)).not.toEqual([]);
  });

  it('keeps a property that is named "description"', () => {
    const before = withValue(
      committed,
      ['components', 'schemas', 'ErrorResponse', 'properties', 'description'],
      { type: 'string' },
    );

    expect(openApiDrift(committed, before)).toEqual([
      '/components/schemas/ErrorResponse/properties/description',
    ]);
  });
});
