import { z } from 'zod';

/**
 * Structured output contract for the agentic suggest-path engine.
 *
 * The contract exists in two representations:
 *
 * - `agenticEngineOutputSchema` (zod) — the single source for the TS type
 *   (`z.infer`) and the engine-side re-validation (`isAgenticEngineOutput`).
 * - `AGENTIC_OUTPUT_JSON_SCHEMA` — hand-written rather than converted from
 *   Zod: OpenAI structured-output strict mode requires
 *   `additionalProperties: false` and an exhaustive `required` list at every
 *   object level, and Zod-to-JSON-Schema conversion does not guarantee this
 *   (mastra-ai/mastra#16383).
 *
 * The two are kept in sync by the co-located spec, which asserts the JSON
 * Schema's required/enum values against the shapes the zod schema accepts.
 *
 * Validation is intentionally doubled (defense in depth): Mastra's
 * structuring pass enforces the JSON Schema, and `isAgenticEngineOutput`
 * re-validates the result on the engine side.
 */

/**
 * Maximum number of suggestions surfaced to the API. Shared by the JSON
 * Schema (`maxItems`, advisory for the model) and the engine adapter, which
 * enforces the cap itself (design.md AgenticEngine output-mapping rules).
 */
export const SUGGESTION_CAP = 20;

const suggestionEntrySchema = z.strictObject({
  /** Parent directory path with trailing slash */
  path: z.string(),
  label: z.string(),
  description: z.string(),
});

/**
 * Engine-side re-validation schema. Strict objects give excess-property
 * rejection at both levels (strict-mode parity with the JSON Schema).
 *
 * Deliberately NOT enforced here: the item cap (`SUGGESTION_CAP`) and the
 * trailing-slash path form — the engine adapter truncates and normalizes
 * those (design: AgenticEngine output mapping rules); this schema validates
 * structure only.
 */
export const agenticEngineOutputSchema = z.strictObject({
  informationType: z.enum(['flow', 'stock']),
  suggestions: z.array(suggestionEntrySchema),
});

export type AgenticEngineOutput = z.infer<typeof agenticEngineOutputSchema>;

export const isAgenticEngineOutput = (
  value: unknown,
): value is AgenticEngineOutput =>
  agenticEngineOutputSchema.safeParse(value).success;

/**
 * Exact-shape type for AGENTIC_OUTPUT_JSON_SCHEMA.
 *
 * `JSONSchema7` (@types/json-schema) is not a direct dependency of apps/app
 * (it is only reachable transitively through @mastra/core), so the constant
 * is pinned with this local literal type instead. The literal tuples lock
 * the schema's `required` / `enum` values at compile time, and the shape
 * stays structurally assignable to the `JSONSchema7` that Mastra's
 * `structuredOutput.schema` option expects (mutable tuples, no readonly
 * arrays).
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
      readonly maxItems: typeof SUGGESTION_CAP;
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
      maxItems: SUGGESTION_CAP,
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
