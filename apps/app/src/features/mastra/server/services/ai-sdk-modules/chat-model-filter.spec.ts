import {
  CATALOG_PROVIDERS,
  isSelectableModel,
  type ModelsDevModel,
} from './chat-model-filter';

describe('chat-model-filter', () => {
  describe('isSelectableModel', () => {
    // Contract (6.1): a model is selectable iff it supports tool calls AND
    // outputs text. Judgment relies solely on authoritative catalog metadata
    // (tool_call flag + output modality), never on name heuristics (6.2).
    const build = (
      tool_call: boolean,
      output: readonly string[],
    ): ModelsDevModel => ({ tool_call, modalities: { output } });

    it('returns true for a tool-call-capable, text-output model', () => {
      expect(isSelectableModel(build(true, ['text']))).toBe(true);
    });

    it('returns false when tool_call is false (tool support required)', () => {
      expect(isSelectableModel(build(false, ['text']))).toBe(false);
    });

    it('returns false for a non-text output modality (e.g. image)', () => {
      expect(isSelectableModel(build(true, ['image']))).toBe(false);
    });

    it('returns true for a multimodal model that still outputs text', () => {
      expect(isSelectableModel(build(true, ['text', 'image']))).toBe(true);
    });

    it('returns false when the output modality list is empty', () => {
      expect(isSelectableModel(build(true, []))).toBe(false);
    });
  });

  describe('CATALOG_PROVIDERS', () => {
    // Contract: providers with a models.dev catalog only. azure-openai is not
    // covered by models.dev (deployment-name IDs), so it must be excluded.
    it('contains openai, anthropic and google', () => {
      expect(CATALOG_PROVIDERS).toContain('openai');
      expect(CATALOG_PROVIDERS).toContain('anthropic');
      expect(CATALOG_PROVIDERS).toContain('google');
    });

    it('does NOT contain azure-openai', () => {
      expect(CATALOG_PROVIDERS.includes('azure-openai')).toBe(false);
    });
  });
});
