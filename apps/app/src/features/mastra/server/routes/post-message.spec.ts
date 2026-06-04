// Mock express-validator's `body()` so we can introspect which fields the
// validator chain declares without invoking the lodash-dependent runtime
// engine (express-validator@6 cannot resolve `lodash` in this test sandbox).
//
// Each mocked chain records the field name it was created for and the modifier
// methods called on it (isUUID, optional, custom, ...). Chains are fluent, so
// every method returns the same recorder.
type ChainRecorder = {
  field: string;
  calls: string[];
  customFn?: (data: unknown) => unknown;
} & Record<string, (...args: unknown[]) => ChainRecorder>;

const createdChains: ChainRecorder[] = [];

vi.mock('express-validator', () => {
  const body = (field: string): ChainRecorder => {
    const recorder = { field, calls: [] } as ChainRecorder;
    const fluent = new Proxy(recorder, {
      get(target, prop: string) {
        if (prop === 'field' || prop === 'calls' || prop === 'customFn') {
          return target[prop as 'field' | 'calls' | 'customFn'];
        }
        return (...args: unknown[]) => {
          target.calls.push(prop);
          if (prop === 'custom' && typeof args[0] === 'function') {
            target.customFn = args[0] as (data: unknown) => unknown;
          }
          return fluent;
        };
      },
    });
    createdChains.push(recorder);
    return fluent;
  };
  return { body };
});

import { buildPostMessageValidator } from './post-message-validator';

beforeEach(() => {
  createdChains.length = 0;
});

describe('buildPostMessageValidator', () => {
  const validateUIMessages = vi.fn().mockResolvedValue(undefined);

  it('declares no aiAssistantId field (assistant-independent contract)', () => {
    buildPostMessageValidator(validateUIMessages);

    const fields = createdChains.map((c) => c.field);
    expect(fields).not.toContain('aiAssistantId');
  });

  it('declares threadId as an optional field and a messages field', () => {
    buildPostMessageValidator(validateUIMessages);

    const fields = createdChains.map((c) => c.field);
    expect(fields).toContain('threadId');
    expect(fields).toContain('messages');

    const threadIdChain = createdChains.find((c) => c.field === 'threadId');
    expect(threadIdChain?.calls).toContain('optional');
  });

  it('delegates messages validation to the injected validateUIMessages', async () => {
    buildPostMessageValidator(validateUIMessages);

    const messagesChain = createdChains.find((c) => c.field === 'messages');
    const sampleMessages = [{ id: '1', role: 'user', parts: [] }];

    await messagesChain?.customFn?.(sampleMessages);

    expect(validateUIMessages).toHaveBeenCalledWith({
      messages: sampleMessages,
    });
  });
});
