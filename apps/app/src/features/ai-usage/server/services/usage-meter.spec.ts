import { buildModelKey } from '~/features/mastra/interfaces/model-key';

import type { AiUsageEntry } from './record-ai-usage';
import type { TokenUsage } from './token-usage';
import { createUsageMeter } from './usage-meter';

const { recordAiUsage, loggerWarn } = vi.hoisted(() => ({
  recordAiUsage: vi.fn<(entry: AiUsageEntry) => Promise<void>>(),
  loggerWarn: vi.fn(),
}));

vi.mock('./record-ai-usage', () => ({ recordAiUsage }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    error: vi.fn(),
    warn: loggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const modelKey = buildModelKey('openai', 'gpt-5');

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
});

const createMeter = () =>
  createUsageMeter({ userId: 'user-1', feature: 'chat', modelKey });

describe('createUsageMeter', () => {
  beforeEach(() => {
    recordAiUsage.mockReset();
    recordAiUsage.mockResolvedValue(undefined);
    loggerWarn.mockReset();
  });

  it('records the calls of one response as a single record on close', () => {
    const meter = createMeter();
    meter.add(usage(10, 1));
    meter.add(usage(20, 2));
    expect(recordAiUsage).not.toHaveBeenCalled();

    meter.close({ outcome: 'completed' });

    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith({
      userId: 'user-1',
      feature: 'chat',
      modelKey,
      calls: [usage(10, 1), usage(20, 2)],
    });
  });

  it('writes only one record when closed many times', () => {
    const meter = createMeter();
    meter.add(usage(10, 1));

    meter.close({ outcome: 'completed' });
    meter.close({ outcome: 'completed' });
    meter.close({ outcome: 'failed' });

    expect(recordAiUsage).toHaveBeenCalledTimes(1);
  });

  it('records the collected calls when closed as a failure', () => {
    const meter = createMeter();
    meter.add(usage(10, 1));

    meter.close({ outcome: 'failed' });

    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ calls: [usage(10, 1)] }),
    );
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('warns with user, feature and model when closed as a failure with no calls', () => {
    const meter = createMeter();

    meter.close({ outcome: 'failed' });

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', feature: 'chat', modelKey }),
      expect.any(String),
    );
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it('does not warn when closed as completed with no calls', () => {
    createMeter().close({ outcome: 'completed' });

    expect(loggerWarn).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it('records each call arriving after close as its own single-call record', () => {
    const meter = createMeter();
    meter.add(usage(10, 1));
    meter.close({ outcome: 'failed' });
    recordAiUsage.mockClear();

    meter.add(usage(5, 5));
    meter.add(usage(6, 6));

    expect(recordAiUsage).toHaveBeenCalledTimes(2);
    expect(recordAiUsage).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      feature: 'chat',
      modelKey,
      calls: [usage(5, 5)],
    });
    expect(recordAiUsage).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      feature: 'chat',
      modelKey,
      calls: [usage(6, 6)],
    });
  });

  it('never throws even if recording throws synchronously or rejects', () => {
    const meter = createMeter();
    meter.add(usage(1, 1));
    recordAiUsage.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => meter.close({ outcome: 'completed' })).not.toThrow();

    recordAiUsage.mockRejectedValueOnce(new Error('rejected'));
    expect(() => meter.add(usage(2, 2))).not.toThrow();
  });
});
