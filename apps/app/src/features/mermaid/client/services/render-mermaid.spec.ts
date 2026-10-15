import mermaid, { type RenderResult } from 'mermaid';
import { mock } from 'vitest-mock-extended';

import { scheduleMermaidRender } from './render-mermaid';

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

const result = (svg: string): RenderResult => ({
  svg,
  diagramType: 'swimlane',
});
const request = (source: string, isDarkMode = false) => ({
  source,
  isDarkMode,
  container: mock<HTMLDivElement>({ isConnected: true, innerHTML: '' }),
  onRendered: vi.fn(),
  onError: vi.fn(),
});

describe('scheduleMermaidRender', () => {
  beforeEach(() => {
    vi.mocked(mermaid.initialize).mockReset();
    vi.mocked(mermaid.render).mockReset();
  });

  it('serializes configuration, rendering, publication and notification in FIFO order', async () => {
    const first = request('first');
    const second = request('second', true);
    const third = request('third');
    const pending = Promise.withResolvers<RenderResult>();
    const order: string[] = [];
    first.onRendered.mockImplementation(() =>
      order.push(first.container.innerHTML),
    );
    second.onRendered.mockImplementation(() =>
      order.push(second.container.innerHTML),
    );
    third.onRendered.mockImplementation(() =>
      order.push(third.container.innerHTML),
    );
    vi.mocked(mermaid.render)
      .mockReturnValueOnce(pending.promise)
      .mockImplementationOnce(() => {
        expect(order).toEqual(['first-svg']);
        return Promise.resolve(result('second-svg'));
      })
      .mockResolvedValueOnce(result('third-svg'));

    scheduleMermaidRender(first);
    scheduleMermaidRender(second);
    scheduleMermaidRender(third);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    pending.resolve(result('first-svg'));
    await vi.waitFor(() => expect(third.onRendered).toHaveBeenCalledOnce());

    expect(order).toEqual(['first-svg', 'second-svg', 'third-svg']);
    expect(vi.mocked(mermaid.initialize).mock.calls).toEqual([
      [{ theme: undefined }],
      [{ theme: 'dark' }],
      [{ theme: undefined }],
    ]);
    const ids = vi.mocked(mermaid.render).mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(3);
  });

  it('removes superseded pending requests without rendering or notifying them', async () => {
    const pending = Promise.withResolvers<RenderResult>();
    vi.mocked(mermaid.render)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(result('latest'));
    scheduleMermaidRender(request('active'));
    const discarded = Array.from({ length: 30 }, (_, i) => request(`old-${i}`));
    for (const old of discarded) scheduleMermaidRender(old)();
    const latest = request('latest');
    scheduleMermaidRender(latest);
    pending.resolve(result('active'));
    await vi.waitFor(() => expect(latest.onRendered).toHaveBeenCalledOnce());
    expect(
      vi.mocked(mermaid.render).mock.calls.map(([, source]) => source),
    ).toEqual(['active', 'latest']);
    for (const old of discarded) {
      expect(old.onRendered).not.toHaveBeenCalled();
      expect(old.onError).not.toHaveBeenCalled();
      expect(old.container.innerHTML).toBe('');
    }
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('holds the lock until a cancelled active render settles: %s', async (settlement) => {
    const pending = Promise.withResolvers<RenderResult>();
    const old = request('old');
    const latest = { ...request('latest'), container: old.container };
    vi.mocked(mermaid.render)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(result('latest'));
    const cancel = scheduleMermaidRender(old);
    cancel();
    scheduleMermaidRender(latest);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    if (settlement === 'resolve') pending.resolve(result('stale'));
    else pending.reject(new Error('obsolete'));
    await vi.waitFor(() => expect(latest.onRendered).toHaveBeenCalledOnce());
    expect(old.onRendered).not.toHaveBeenCalled();
    expect(old.onError).not.toHaveBeenCalled();
    expect(latest.container.innerHTML).toBe('latest');
  });

  it.each([
    'initialize',
    'render',
    'notify',
  ] as const)('recovers after %s throws or rejects', async (failure) => {
    const error = new Error('failed');
    const first = request('first');
    const next = request('next');
    vi.mocked(mermaid.render).mockResolvedValue(result('valid'));
    if (failure === 'initialize')
      vi.mocked(mermaid.initialize).mockImplementationOnce(() => {
        throw error;
      });
    if (failure === 'render')
      vi.mocked(mermaid.render).mockRejectedValueOnce(error);
    if (failure === 'notify')
      first.onRendered.mockImplementationOnce(() => {
        throw error;
      });
    first.onError.mockImplementationOnce(() => {
      throw new Error('error callback failed');
    });
    scheduleMermaidRender(first);
    scheduleMermaidRender(next);
    await vi.waitFor(() => expect(next.onRendered).toHaveBeenCalledOnce());
    expect(first.onError).toHaveBeenCalledWith(error);
    expect(next.container.innerHTML).toBe('valid');
  });

  it('does not start work for a disconnected container', async () => {
    const detached = {
      ...request('detached'),
      container: mock<HTMLDivElement>({ isConnected: false }),
    };
    const next = request('next');
    vi.mocked(mermaid.render).mockResolvedValue(result('next'));
    scheduleMermaidRender(detached);
    scheduleMermaidRender(next);
    await vi.waitFor(() => expect(next.onRendered).toHaveBeenCalledOnce());
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(detached.onRendered).not.toHaveBeenCalled();
    expect(detached.onError).not.toHaveBeenCalled();
  });

  it('does not publish when the container disconnects during rendering', async () => {
    const pending = Promise.withResolvers<RenderResult>();
    const first = request('first');
    let connected = true;
    Object.defineProperty(first.container, 'isConnected', {
      get: () => connected,
    });
    vi.mocked(mermaid.render)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(result('next'));
    scheduleMermaidRender(first);
    connected = false;
    const next = request('next');
    scheduleMermaidRender(next);
    pending.resolve(result('stale'));
    await vi.waitFor(() => expect(next.onRendered).toHaveBeenCalledOnce());
    expect(first.container.innerHTML).toBe('');
    expect(first.onRendered).not.toHaveBeenCalled();
  });
});
