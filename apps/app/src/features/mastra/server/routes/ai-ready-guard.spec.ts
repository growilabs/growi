// --- Mock boundary ---------------------------------------------------------
//
// aiReadyGuard is a thin per-request Express middleware over two collaborators:
//   - isAiEnabled()    (openai/server/services) — is the AI feature toggled on?
//   - isAiConfigured() (./is-ai-configured-ish service) — are provider + required
//                      fields valid?
// The observable contract is:
//   - disabled            -> apiv3Err(501) with the "not enabled" message, next NOT called
//   - enabled+unconfigured-> apiv3Err(501) with the "not configured" message, next NOT called
//   - enabled+configured  -> next() called, no apiv3Err
//   - readiness is evaluated PER REQUEST (changing a collaborator's verdict between
//     two invocations flips the outcome without re-importing the module — Req 7.5)
// We mock both collaborators so the test exercises only this middleware's gating
// behavior, not how readiness is actually computed.
const { isAiEnabled, isAiConfigured } = vi.hoisted(() => ({
  isAiEnabled: vi.fn(),
  isAiConfigured: vi.fn(),
}));

vi.mock('~/features/openai/server/services', () => ({
  isAiEnabled,
}));

vi.mock('~/features/mastra/server/services/is-ai-configured', () => ({
  isAiConfigured,
  isAiReady: () => isAiEnabled() && isAiConfigured(),
}));

import type { NextFunction, Request } from 'express';
import { mock } from 'vitest-mock-extended';

import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { aiReadyGuard } from './ai-ready-guard';

const invokeGuard = () => {
  const req = mock<Request>();
  const res = mock<ApiV3Response>();
  const next: NextFunction = vi.fn();
  aiReadyGuard(req, res, next);
  return { res, next };
};

// Extract the ErrorV3-or-string message regardless of how the guard wraps it,
// so the assertion stays on the observable message rather than the wrapper shape.
const messageOf = (errArg: unknown): string => {
  if (typeof errArg === 'string') return errArg;
  if (errArg != null && typeof errArg === 'object' && 'message' in errArg) {
    return String((errArg as { message: unknown }).message);
  }
  return '';
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('aiReadyGuard (Req 7.2, 7.3, 7.5)', () => {
  it('rejects with 501 and a "not enabled" message when AI is disabled (Req 7.2)', () => {
    isAiEnabled.mockReturnValue(false);
    isAiConfigured.mockReturnValue(true);

    const { res, next } = invokeGuard();

    expect(next).not.toHaveBeenCalled();
    expect(res.apiv3Err).toHaveBeenCalledTimes(1);
    const [errArg, status] = res.apiv3Err.mock.calls[0];
    expect(status).toBe(501);
    expect(messageOf(errArg)).toMatch(/not enabled/i);
  });

  it('rejects with 501 and a distinct "not configured" message when enabled but unconfigured (Req 7.2)', () => {
    isAiEnabled.mockReturnValue(true);
    isAiConfigured.mockReturnValue(false);

    const { res, next } = invokeGuard();

    expect(next).not.toHaveBeenCalled();
    expect(res.apiv3Err).toHaveBeenCalledTimes(1);
    const [errArg, status] = res.apiv3Err.mock.calls[0];
    expect(status).toBe(501);
    const message = messageOf(errArg);
    expect(message).toMatch(/not configured/i);
    // distinct from the disabled message so clients can tell the two states apart
    expect(message).not.toMatch(/not enabled/i);
  });

  it('passes the request through (next) when enabled and configured (Req 7.3)', () => {
    isAiEnabled.mockReturnValue(true);
    isAiConfigured.mockReturnValue(true);

    const { res, next } = invokeGuard();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.apiv3Err).not.toHaveBeenCalled();
  });

  it('re-evaluates readiness on every request, so a config change flips the outcome without restart (Req 7.5)', () => {
    // First request: enabled + configured -> passes
    isAiEnabled.mockReturnValue(true);
    isAiConfigured.mockReturnValue(true);
    const first = invokeGuard();
    expect(first.next).toHaveBeenCalledTimes(1);
    expect(first.res.apiv3Err).not.toHaveBeenCalled();

    // Configuration becomes invalid between requests (no module reload / restart)
    isAiConfigured.mockReturnValue(false);
    const second = invokeGuard();
    expect(second.next).not.toHaveBeenCalled();
    expect(second.res.apiv3Err).toHaveBeenCalledTimes(1);
    expect(second.res.apiv3Err.mock.calls[0][1]).toBe(501);
  });
});
