import { renderMarkdownToTextHast } from '~/server/service/markdown-pipeline';

import { resolveMarkdownQuoteAnchor } from './markdown-quote-anchor';
import { renderedTextOfRevision } from './rendered-text-cache';

vi.mock('~/server/service/markdown-pipeline', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('~/server/service/markdown-pipeline')>();
  return {
    ...actual,
    renderMarkdownToTextHast: vi.fn(actual.renderMarkdownToTextHast),
  };
});

const render = vi.mocked(renderMarkdownToTextHast);

// The cache keeps one revision; a fresh id per test keeps the tests independent.
let revisionCounter = 0;
const nextRevision = (body = 'Some **bold** text and more text.') => ({
  id: `revision-${++revisionCounter}`,
  body,
});

describe('renderedTextOfRevision', () => {
  beforeEach(() => {
    render.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a revision once for two creates on it', async () => {
    const revision = nextRevision();

    const first = await resolveMarkdownQuoteAnchor(revision, 'bold');
    const second = await resolveMarkdownQuoteAnchor(revision, 'more text');

    expect(first.kind).toBe('anchored');
    expect(second.kind).toBe('anchored');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders once for concurrent calls on the same revision', async () => {
    const revision = nextRevision();

    const results = await Promise.all([
      renderedTextOfRevision(revision),
      renderedTextOfRevision(revision),
      renderedTextOfRevision(revision),
    ]);

    expect(render).toHaveBeenCalledTimes(1);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it('renders again for a different revision', async () => {
    await renderedTextOfRevision(nextRevision('first body'));
    const second = await renderedTextOfRevision(nextRevision('second body'));

    expect(render).toHaveBeenCalledTimes(2);
    expect(second.text).toBe('second body');
  });

  it('does not keep a failed render', async () => {
    const revision = nextRevision('body after a failure');
    render.mockRejectedValueOnce(new Error('render failed'));

    await expect(renderedTextOfRevision(revision)).rejects.toThrow(
      'render failed',
    );
    const retried = await renderedTextOfRevision(revision);

    expect(render).toHaveBeenCalledTimes(2);
    expect(retried.text).toBe('body after a failure');
  });

  it('renders again once the entry has expired', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const revision = nextRevision();

    await renderedTextOfRevision(revision);
    vi.advanceTimersByTime(60_000);
    await renderedTextOfRevision(revision);

    expect(render).toHaveBeenCalledTimes(2);
  });
});
