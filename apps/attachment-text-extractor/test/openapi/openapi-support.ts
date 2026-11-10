import { Ajv2020 } from 'ajv/dist/2020';

// Checks an actual answer against the OpenAPI document (research.md 17.7 2 (iv)).
// Imports nothing from src/: the black-box tests use it against Python too.

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

// The authentication 401 answers every path before any route runs, so no
// operation documents it (nor did the FastAPI document); it is an ErrorResponse.
const undocumentedSchema = (status: number): Json | undefined =>
  status === 401 ? { $ref: '#/components/schemas/ErrorResponse' } : undefined;

/** Why `value` does not fit the schema (empty when it fits). */
export type SchemaCheck = (value: unknown) => readonly string[];

/** A check of values against one schema of the document, in the strict view. */
export const schemaChecker = (
  document: unknown,
  schema: unknown,
): SchemaCheck => {
  const defs = toDefs(at(toJson(document), 'components', 'schemas') ?? {});
  const root = toDefs(toJson(schema));
  // `binary` is OpenAPI's mark for a file part; any value passes it here.
  const validate = new Ajv2020({
    strict: true,
    formats: { binary: true },
  }).compile(isJsonObject(root) ? { $defs: defs, ...root } : { $defs: defs });
  return (value) =>
    validate(value)
      ? []
      : (validate.errors ?? []).map(
          (error) => `${error.instancePath || '/'} ${error.message ?? ''}`,
        );
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
    const schema = documented ?? undocumentedSchema(status);
    if (schema === undefined) {
      return [`${method} ${path} ${status} is not documented`];
    }
    return schemaChecker(doc, schema)(body);
  };
};

/** The value at `pointer` in a JSON document, or undefined. */
export const textAt = (
  document: unknown,
  pointer: readonly string[],
): unknown => at(toJson(document), ...pointer);
