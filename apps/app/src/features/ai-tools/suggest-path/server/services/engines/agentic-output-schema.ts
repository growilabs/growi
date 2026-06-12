/**
 * Structured output contract for the agentic suggest-path engine.
 *
 * The JSON Schema is hand-written rather than converted from Zod: OpenAI
 * structured-output strict mode requires `additionalProperties: false` and an
 * exhaustive `required` list at every object level, and Zod-to-JSON-Schema
 * conversion does not guarantee this (mastra-ai/mastra#16383).
 *
 * Validation is intentionally doubled (defense in depth): Mastra's
 * structuring pass enforces this schema, and `isAgenticEngineOutput`
 * re-validates the result on the engine side.
 */

export type AgenticEngineOutput = {
  readonly informationType: 'flow' | 'stock';
  readonly suggestions: ReadonlyArray<{
    /** Parent directory path with trailing slash */
    readonly path: string;
    readonly label: string;
    readonly description: string;
  }>;
};

/**
 * Exact-shape type for AGENTIC_OUTPUT_JSON_SCHEMA.
 *
 * `JSONSchema7` (@types/json-schema) is not a direct dependency of apps/app
 * (it is only reachable transitively through @mastra/core), so the constant
 * is pinned with this local literal type instead. The literal tuples lock
 * the schema's `required` / `enum` values against drift from
 * `AgenticEngineOutput` at compile time, and the shape stays structurally
 * assignable to the `JSONSchema7` that Mastra's `structuredOutput.schema`
 * option expects (mutable tuples, no readonly arrays).
 */
type AgenticOutputJsonSchema = {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly required: ['informationType', 'suggestions'];
  readonly properties: {
    readonly informationType: {
      readonly type: 'string';
      readonly enum: ['flow', 'stock'];
      readonly description: string;
    };
    readonly suggestions: {
      readonly type: 'array';
      readonly maxItems: 20;
      readonly items: {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly required: ['path', 'label', 'description'];
        readonly properties: {
          readonly path: {
            readonly type: 'string';
            readonly description: string;
          };
          readonly label: { readonly type: 'string' };
          readonly description: { readonly type: 'string' };
        };
      };
    };
  };
};

export const AGENTIC_OUTPUT_JSON_SCHEMA: AgenticOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['informationType', 'suggestions'],
  properties: {
    informationType: {
      type: 'string',
      enum: ['flow', 'stock'],
      description:
        'Whether the document is flow (time-bound) or stock (reference) information',
    },
    suggestions: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'label', 'description'],
        properties: {
          path: {
            type: 'string',
            description: 'Parent directory path with trailing slash',
          },
          label: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
};

// In strict mode every property is required, so the schema's `required`
// arrays double as the exhaustive key allowlists for excess-property checks.
// Deriving them (and the enum) from the schema constant keeps the guard and
// the schema a single definition that cannot drift apart.
const TOP_LEVEL_KEYS: readonly string[] = AGENTIC_OUTPUT_JSON_SCHEMA.required;
const SUGGESTION_KEYS: readonly string[] =
  AGENTIC_OUTPUT_JSON_SCHEMA.properties.suggestions.items.required;
const INFORMATION_TYPE_VALUES: readonly unknown[] =
  AGENTIC_OUTPUT_JSON_SCHEMA.properties.informationType.enum;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const hasOnlyKeys = (
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean => {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
};

const isSuggestionEntry = (value: unknown): boolean => {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (!hasOnlyKeys(value, SUGGESTION_KEYS)) {
    return false;
  }
  return (
    typeof value.path === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string'
  );
};

/**
 * Engine-side re-validation of the agent's structured output.
 * Strict-mode parity: unknown keys at either level are rejected.
 *
 * Deliberately NOT enforced here: the 20-item cap (`maxItems`) and the
 * trailing-slash path form — the engine adapter truncates and normalizes
 * those (design: AgenticEngine output mapping rules); the guard validates
 * structure only.
 */
export const isAgenticEngineOutput = (
  value: unknown,
): value is AgenticEngineOutput => {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (!hasOnlyKeys(value, TOP_LEVEL_KEYS)) {
    return false;
  }
  if (!INFORMATION_TYPE_VALUES.includes(value.informationType)) {
    return false;
  }
  if (!Array.isArray(value.suggestions)) {
    return false;
  }
  return value.suggestions.every(isSuggestionEntry);
};
