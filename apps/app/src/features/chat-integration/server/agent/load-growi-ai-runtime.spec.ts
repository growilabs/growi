import { mock } from 'vitest-mock-extended';

import type { GrowiAiRuntime } from './growi-ai-gateway-types';
import { createGrowiAiRuntimeLoader } from './load-growi-ai-runtime';

describe('createGrowiAiRuntimeLoader', () => {
  it('loads the AI module once and reuses it', async () => {
    const runtime = mock<GrowiAiRuntime>();
    const importRuntime = vi.fn(async () => runtime);
    const load = createGrowiAiRuntimeLoader(importRuntime);

    const [first, second] = await Promise.all([load(), load()]);
    const third = await load();

    expect([first, second, third]).toEqual([runtime, runtime, runtime]);
    expect(importRuntime).toHaveBeenCalledTimes(1);
  });

  it('loads again on the next call after a failed load', async () => {
    const runtime = mock<GrowiAiRuntime>();
    const importRuntime = vi
      .fn<() => Promise<GrowiAiRuntime>>()
      .mockRejectedValueOnce(new Error('import failed'))
      .mockResolvedValueOnce(runtime);
    const load = createGrowiAiRuntimeLoader(importRuntime);

    await expect(load()).rejects.toThrow('import failed');
    expect(await load()).toBe(runtime);
  });
});
