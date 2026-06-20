// --- Mock boundaries -------------------------------------------------------
//
// isAiConfigured/isAiReady are thin compositions over two collaborators:
//   - resolveMastraModel(): the SINGLE source of "configured?" truth — it throws
//     when the provider/required config is missing and returns a model otherwise.
//   - isAiEnabled(): the app:aiEnabled toggle.
// The observable contract is the mapping (throw -> false, success -> true) and the
// AND composition — not how resolveMastraModel validates internally. We mock both
// collaborators so the test exercises only this module's behavior.
const { resolveMastraModel, isAiEnabled } = vi.hoisted(() => ({
  resolveMastraModel: vi.fn(),
  isAiEnabled: vi.fn(),
}));

vi.mock('./ai-sdk-modules/resolve-mastra-model', () => ({
  resolveMastraModel,
}));

vi.mock('~/features/openai/server/services', () => ({
  isAiEnabled,
}));

import { isAiConfigured, isAiReady } from './is-ai-configured';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isAiConfigured (Req 7.2, 7.3)', () => {
  it('returns true when resolveMastraModel succeeds (provider + required config present)', () => {
    resolveMastraModel.mockReturnValue({ tag: 'some-model' });

    expect(isAiConfigured()).toBe(true);
  });

  it('returns false when resolveMastraModel throws (provider unset / required config missing)', () => {
    resolveMastraModel.mockImplementation(() => {
      throw new Error('Unsupported Mastra LLM provider');
    });

    expect(isAiConfigured()).toBe(false);
  });

  it('swallows the throw and never propagates the (potentially sensitive) error', () => {
    resolveMastraModel.mockImplementation(() => {
      throw new Error('missing required config for azure-openai');
    });

    // The contract is a boolean verdict, not an exception — the caller (guard,
    // sidebar supplier) must never see resolveMastraModel's error escape.
    expect(() => isAiConfigured()).not.toThrow();
  });

  it("parity: isAiConfigured tracks resolveMastraModel's success/failure exactly", () => {
    // configured === resolveMastraModel resolves; not-configured === it throws.
    resolveMastraModel.mockReturnValue({ tag: 'model' });
    expect(isAiConfigured()).toBe(true);

    resolveMastraModel.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(isAiConfigured()).toBe(false);
  });
});

describe('isAiReady (Req 7.2, 7.3, 7.4)', () => {
  it('is true only when AI is enabled AND configured', () => {
    isAiEnabled.mockReturnValue(true);
    resolveMastraModel.mockReturnValue({ tag: 'model' });

    expect(isAiReady()).toBe(true);
  });

  it('is false when AI is disabled even though it is configured', () => {
    isAiEnabled.mockReturnValue(false);
    resolveMastraModel.mockReturnValue({ tag: 'model' });

    expect(isAiReady()).toBe(false);
  });

  it('is false when AI is enabled but not configured', () => {
    isAiEnabled.mockReturnValue(true);
    resolveMastraModel.mockImplementation(() => {
      throw new Error('not configured');
    });

    expect(isAiReady()).toBe(false);
  });

  it('is false when AI is both disabled and not configured', () => {
    isAiEnabled.mockReturnValue(false);
    resolveMastraModel.mockImplementation(() => {
      throw new Error('not configured');
    });

    expect(isAiReady()).toBe(false);
  });
});
