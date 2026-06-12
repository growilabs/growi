import {
  AGENTIC_OUTPUT_JSON_SCHEMA,
  isAgenticEngineOutput,
} from './agentic-output-schema';

const createValidSuggestion = (): Record<string, unknown> => ({
  path: '/docs/specs/',
  label: 'Specs',
  description: 'Fits alongside the existing specification documents',
});

const createValidOutput = (): Record<string, unknown> => ({
  informationType: 'stock',
  suggestions: [createValidSuggestion()],
});

const outputWithSuggestion = (suggestion: unknown): unknown => ({
  informationType: 'stock',
  suggestions: [suggestion],
});

describe('isAgenticEngineOutput', () => {
  describe('valid outputs', () => {
    it('accepts a stock output with a suggestion', () => {
      expect(isAgenticEngineOutput(createValidOutput())).toBe(true);
    });

    it('accepts a flow output', () => {
      const value = { ...createValidOutput(), informationType: 'flow' };
      expect(isAgenticEngineOutput(value)).toBe(true);
    });

    it('accepts an empty suggestions array', () => {
      const value = { ...createValidOutput(), suggestions: [] };
      expect(isAgenticEngineOutput(value)).toBe(true);
    });

    // The guard validates structure only; the 20-item cap is enforced by the
    // schema's maxItems plus adapter-side truncation (design: AgenticEngine
    // mapping rules), so a longer array must still pass the guard.
    it('accepts more than 20 suggestions', () => {
      const value = {
        ...createValidOutput(),
        suggestions: Array.from({ length: 21 }, () => createValidSuggestion()),
      };
      expect(isAgenticEngineOutput(value)).toBe(true);
    });
  });

  describe('non-object inputs', () => {
    it.each([null, undefined, 'text', 42, true])('rejects %s', (value) => {
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects an array', () => {
      expect(isAgenticEngineOutput([createValidOutput()])).toBe(false);
    });
  });

  describe('informationType violations', () => {
    it('rejects a value outside the flow/stock union', () => {
      const value = { ...createValidOutput(), informationType: 'memo' };
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a missing informationType', () => {
      const value = { suggestions: [createValidSuggestion()] };
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a non-string informationType', () => {
      const value = { ...createValidOutput(), informationType: 1 };
      expect(isAgenticEngineOutput(value)).toBe(false);
    });
  });

  describe('suggestions violations', () => {
    it('rejects missing suggestions', () => {
      const value = { informationType: 'stock' };
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects non-array suggestions', () => {
      const value = {
        ...createValidOutput(),
        suggestions: createValidSuggestion(),
      };
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a suggestion entry missing path', () => {
      const value = outputWithSuggestion({
        label: 'Specs',
        description: 'desc',
      });
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a suggestion entry with a non-string path', () => {
      const value = outputWithSuggestion({
        ...createValidSuggestion(),
        path: 123,
      });
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a suggestion entry missing label', () => {
      const value = outputWithSuggestion({
        path: '/docs/specs/',
        description: 'desc',
      });
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a suggestion entry missing description', () => {
      const value = outputWithSuggestion({
        path: '/docs/specs/',
        label: 'Specs',
      });
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects a non-object suggestion entry', () => {
      const value = outputWithSuggestion('/docs/specs/');
      expect(isAgenticEngineOutput(value)).toBe(false);
    });
  });

  describe('excess property rejection (strict-mode parity)', () => {
    it('rejects an unknown top-level property', () => {
      const value = { ...createValidOutput(), reasoning: 'extra' };
      expect(isAgenticEngineOutput(value)).toBe(false);
    });

    it('rejects an unknown property on a suggestion entry', () => {
      const value = outputWithSuggestion({
        ...createValidSuggestion(),
        score: 0.9,
      });
      expect(isAgenticEngineOutput(value)).toBe(false);
    });
  });
});

// Locks the JSON Schema constant to the values mirrored by the
// AgenticEngineOutput TS type (required keys, enum members), so the two
// definitions cannot drift apart silently.
describe('AGENTIC_OUTPUT_JSON_SCHEMA (schema-type consistency)', () => {
  it('declares the strict-mode object contract at the top level', () => {
    expect(AGENTIC_OUTPUT_JSON_SCHEMA.type).toBe('object');
    expect(AGENTIC_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(AGENTIC_OUTPUT_JSON_SCHEMA.required).toEqual([
      'informationType',
      'suggestions',
    ]);
    expect(Object.keys(AGENTIC_OUTPUT_JSON_SCHEMA.properties)).toEqual([
      'informationType',
      'suggestions',
    ]);
  });

  it('pins informationType to the flow/stock enum', () => {
    const informationType =
      AGENTIC_OUTPUT_JSON_SCHEMA.properties.informationType;
    expect(informationType.type).toBe('string');
    expect(informationType.enum).toEqual(['flow', 'stock']);
  });

  it('caps suggestions at 20 items', () => {
    const suggestions = AGENTIC_OUTPUT_JSON_SCHEMA.properties.suggestions;
    expect(suggestions.type).toBe('array');
    expect(suggestions.maxItems).toBe(20);
  });

  it('declares the strict-mode object contract for suggestion items', () => {
    const items = AGENTIC_OUTPUT_JSON_SCHEMA.properties.suggestions.items;
    expect(items.type).toBe('object');
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(['path', 'label', 'description']);
    expect(Object.keys(items.properties)).toEqual([
      'path',
      'label',
      'description',
    ]);
    expect(items.properties.path.type).toBe('string');
    expect(items.properties.label.type).toBe('string');
    expect(items.properties.description.type).toBe('string');
  });
});
