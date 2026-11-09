import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020';

// Checks an actual answer against the OpenAPI document (research.md 17.7 2 (iv)).
// Imports nothing from src/: the black-box tests use it against Python too.

export const COMMITTED_OPENAPI_PATH = fileURLToPath(
  new URL(
    '../../../../packages/attachment-text-extractor-client/openapi.json',
    import.meta.url,
  ),
);

export const readCommittedOpenApi = (): unknown =>
  JSON.parse(readFileSync(COMMITTED_OPENAPI_PATH, 'utf8'));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isJsonObject = (value: Json): value is { [key: string]: Json } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toJson = (value: unknown): Json => JSON.parse(JSON.stringify(value));

const at = (node: Json, ...keys: string[]): Json | undefined =>
  keys.reduce<Json | undefined>(
    (current, key) =>
      current !== undefined && isJsonObject(current) ? current[key] : undefined,
    node,
  );

// Test-only stricter view: an object with `properties` admits no other key, so
// a field the code adds without documenting it fails (the document is unchanged).
const closeObjects = (node: Json): Json => {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (!isJsonObject(node)) return node;
  const out = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, closeObjects(value)]),
  );
  return 'properties' in node ? { ...out, additionalProperties: false } : out;
};

const toDefs = (schema: Json): Json =>
  JSON.parse(
    JSON.stringify(closeObjects(schema)).replaceAll(
      '#/components/schemas/',
      '#/$defs/',
    ),
  );

// Answers the document leaves out on purpose, as the FastAPI service did: the
// authentication 401 on any path, and /readyz's 503 (its 200 schema is {} too).
const undocumentedSchema = (path: string, status: number): Json | undefined => {
  if (status === 401) return { $ref: '#/components/schemas/ErrorResponse' };
  if (path === '/readyz' && status === 503) return {};
  return undefined;
};

export type ResponseCheck = (
  path: string,
  method: string,
  status: number,
  body: unknown,
) => readonly string[];

/** A checker that lists why an answer does not fit the document (empty when it fits). */
export const responseChecker = (document: unknown): ResponseCheck => {
  const doc = toJson(document);
  const schemas = at(doc, 'components', 'schemas') ?? {};
  const ajv = new Ajv2020({ strict: true });
  return (path, method, status, body) => {
    const documented = at(
      doc,
      'paths',
      path,
      method.toLowerCase(),
      'responses',
      String(status),
      'content',
      'application/json',
      'schema',
    );
    const schema = documented ?? undocumentedSchema(path, status);
    if (schema === undefined) {
      return [`${method} ${path} ${status} is not documented`];
    }
    const defs = toDefs(schemas);
    const root = toDefs(schema);
    const validate = ajv.compile(
      isJsonObject(root) ? { $defs: defs, ...root } : { $defs: defs },
    );
    return validate(body)
      ? []
      : (validate.errors ?? []).map(
          (error) => `${error.instancePath || '/'} ${error.message ?? ''}`,
        );
  };
};

/**
 * The document without its annotation `description`s; a property that is
 * itself named "description" (inside `properties`) is kept (research.md 17.3 2).
 * Comparing exactly replaces this at 8.2.
 */
export const withoutDescriptions = (value: unknown): unknown => {
  const strip = (node: Json, parentKey?: string): Json => {
    if (Array.isArray(node)) return node.map((item) => strip(item));
    if (!isJsonObject(node)) return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => parentKey === 'properties' || key !== 'description')
        .map(([key, item]) => [key, strip(item, key)]),
    );
  };
  return strip(toJson(value));
};

/** The 7.1 description fixes (research.md 17.6): the service's document carries `after`. */
export const DESCRIPTION_FIXES: readonly {
  readonly pointer: readonly string[];
  readonly after: string;
}[] = [
  {
    pointer: ['paths', '/readyz', 'get', 'description'],
    after:
      '200 `ready` when `prlimit` can be run and a probe child process starts, else 503 `not_ready`.\n\nThe body never carries paths or exception text.',
  },
  {
    pointer: ['paths', '/extract', 'post', 'description'],
    after:
      'Receive a multipart upload, enforce the slot and size limits, then convert it in a child process.\n\nThe Bearer token is checked before this operation runs; only authenticated requests reach it.',
  },
  {
    pointer: ['components', 'schemas', 'ErrorCode', 'description'],
    after: 'Machine-readable error codes for all defined failure modes.',
  },
  {
    pointer: ['components', 'schemas', 'ExtractResponse', 'description'],
    after:
      'Successful extraction response returned by POST /extract.\n\nextractedCharacters is the total number of characters (Unicode code points) in content\nacross all pages and is provided for audit logging and metrics purposes.',
  },
  {
    pointer: ['components', 'schemas', 'PageInfo', 'description'],
    after:
      'Information extracted from a single logical page or section of a document.\n\npageNumber and label are null when the source format has no positional\npage concept (e.g. plain text files).',
  },
];

/** The string at `pointer` in a JSON document, or undefined. */
export const textAt = (
  document: unknown,
  pointer: readonly string[],
): unknown => at(toJson(document), ...pointer);
