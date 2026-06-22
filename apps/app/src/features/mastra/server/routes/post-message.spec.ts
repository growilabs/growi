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
    // WHY (Tier-3 cast): ChainRecorder models a Proxy-based stand-in for
    // express-validator's fluent ValidationChain. `mock<ValidationChain>()`
    // cannot reproduce the field/method recording behavior these tests need,
    // so a localized cast on this seed object is acceptable. The recorder gains
    // its fluent methods via the Proxy below.
    const recorder = { field, calls: [] } as unknown as ChainRecorder;
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

// NOTE (test design): because express-validator cannot run in this sandbox
// (lodash resolution), these tests introspect the validator's declared shape
// rather than exercising real request pass/fail. The load-bearing contract is
// "no aiAssistantId field"; the `.calls`/delegation assertions are a pragmatic
// proxy. If express-validator becomes runnable here, prefer replacing them with
// behavior tests that run the chain against sample request bodies.
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

  it('declares modelId as an optional string field (Req 3.3, 4.x)', () => {
    buildPostMessageValidator(validateUIMessages);

    const modelIdChain = createdChains.find((c) => c.field === 'modelId');
    expect(modelIdChain).toBeDefined();
    // optional so an omitted modelId is valid (server rounds to default);
    // isString so a non-string modelId is rejected with 400.
    expect(modelIdChain?.calls).toContain('optional');
    expect(modelIdChain?.calls).toContain('isString');
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
