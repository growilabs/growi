import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:util:prisma-raw-normalize');

/**
 * Detects whether a value is a BSON `$oid` wrapper: `{ "$oid": "<24-hex>" }`.
 */
function isOidWrapper(obj: Record<string, unknown>): obj is { $oid: string } {
  return '$oid' in obj && typeof obj.$oid === 'string';
}

/**
 * Detects whether a value is a BSON `$date` ISO string wrapper: `{ "$date": "<ISO string>" }`.
 */
function isDateIsoWrapper(
  obj: Record<string, unknown>,
): obj is { $date: string } {
  return '$date' in obj && typeof obj.$date === 'string';
}

/**
 * Detects whether a value is a BSON `$date` `$numberLong` wrapper:
 * `{ "$date": { "$numberLong": "<ms as string>" } }`.
 */
function isDateNumberLongWrapper(
  obj: Record<string, unknown>,
): obj is { $date: { $numberLong: string } } {
  if (!('$date' in obj)) return false;
  const dateVal = obj.$date;
  return (
    dateVal !== null &&
    typeof dateVal === 'object' &&
    !Array.isArray(dateVal) &&
    '$numberLong' in (dateVal as Record<string, unknown>) &&
    typeof (dateVal as Record<string, unknown>).$numberLong === 'string'
  );
}

/**
 * Returns true if the object is a BSON wrapper: a single-key object whose only
 * key starts with `$`.
 *
 * Rule: a wrapper is identified by exactly ONE key that starts with `$`. An
 * object with multiple keys (even if some begin with `$`) is a plain object
 * and is recursed into without wrapper-dispatch logic.
 */
function isBsonWrapper(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  return keys.length === 1 && keys[0].startsWith('$');
}

/**
 * Normalizes a single value returned from Prisma `aggregateRaw` (MongoDB
 * Extended JSON / EJSON) into plain JavaScript types:
 *
 * - `{ "$oid": "<24-hex>" }` → `string`
 * - `{ "$date": "<ISO string>" }` → `Date`
 * - `{ "$date": { "$numberLong": "<ms>" } }` → `Date`
 * - Plain objects → recursed field-by-field
 * - Arrays → each element recursed
 * - Primitives (string / number / boolean / null) → passed through unchanged
 *
 * If a single-`$`-key object is encountered that is NOT one of the handled
 * wrappers above, an error is thrown with the unexpected wrapper key included
 * in the message. This provides early detection of unhandled BSON types that
 * would otherwise silently corrupt downstream data.
 *
 * @param value - An `aggregateRaw` result element (`unknown` input).
 * @returns The normalized value.
 * @throws Error if an unrecognized single-`$`-key BSON wrapper is encountered.
 */
export function normalizeAggregateRaw(value: unknown): unknown {
  // Primitives and null pass through unchanged
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Arrays: recurse into each element
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAggregateRaw(item));
  }

  // Object: check for BSON wrapper or recurse as plain object
  const obj = value as Record<string, unknown>;

  if (isBsonWrapper(obj)) {
    const wrapperKey = Object.keys(obj)[0];

    if (isOidWrapper(obj)) {
      return obj.$oid;
    }

    if (isDateIsoWrapper(obj)) {
      return new Date(obj.$date);
    }

    if (isDateNumberLongWrapper(obj)) {
      return new Date(Number(obj.$date.$numberLong));
    }

    // Unrecognized BSON wrapper — throw with context for early detection
    const errorMessage = `Unrecognized BSON wrapper in aggregateRaw result: key "${wrapperKey}" is not handled. Add a normalizer for this type or investigate the pipeline output.`;
    logger.error({ wrapperKey }, errorMessage);
    throw new Error(errorMessage);
  }

  // Plain object (multi-key or zero-key): recurse into each value
  const normalized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    normalized[key] = normalizeAggregateRaw(val);
  }
  return normalized;
}

/**
 * Wraps an ID string in the MongoDB Extended JSON `$oid` form that
 * `aggregateRaw` requires to match against a real BSON ObjectId field.
 *
 * A raw ObjectId instance (e.g. `new mongoose.Types.ObjectId(id)`) or a bare
 * hex string placed directly in an `aggregateRaw` pipeline's `$match`
 * serializes to a plain JSON string, which does NOT match a stored
 * ObjectId-typed field -- the query silently matches zero documents. Use
 * this helper whenever an ObjectId value is compared in a pipeline stage
 * that goes through `aggregateRaw` (verified against a real MongoDB
 * replica set).
 */
export function toRawObjectId(id: string): { $oid: string } {
  return { $oid: id };
}

/**
 * Wraps a Date in the MongoDB Extended JSON `$date` form that `aggregateRaw`
 * requires to compare against a real BSON Date field.
 *
 * A plain `Date` instance (or its ISO string) placed directly in an
 * `aggregateRaw` pipeline's `$match` range comparison (`$gte`/`$lte`)
 * serializes to a bare JSON string, which does NOT compare correctly
 * against a stored BSON Date field -- the query silently matches zero
 * documents. Use this helper whenever a Date value is compared in a
 * pipeline stage that goes through `aggregateRaw` (verified against a real
 * MongoDB replica set).
 */
export function toRawDate(date: Date): { $date: string } {
  return { $date: date.toISOString() };
}

/**
 * Asserts that a value normalized from an `aggregateRaw` result is an
 * array, narrowing its type without a cast.
 *
 * Executors (aggregate-user-activities, aggregate-contributions) previously
 * cast an unvalidated result straight to the expected array/interface type.
 * A structurally wrong pipeline result (e.g. a broken $facet) then produced
 * an empty-looking value indistinguishable from a genuine "no matching
 * activities" outcome. Call this at each structural boundary of a raw
 * result so a shape mismatch fails loudly with the offending path instead
 * of silently flowing through as an empty array.
 */
export function assertIsArray(
  value: unknown,
  context: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Expected an array from aggregateRaw (${context}), got ${typeof value}`,
    );
  }
}
