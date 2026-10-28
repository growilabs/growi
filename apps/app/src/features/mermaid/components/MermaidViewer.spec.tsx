import { createContext, StrictMode, useContext } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { act, cleanup, render } from '@testing-library/react';
import mermaid, { type RenderResult } from 'mermaid';

import { MermaidViewer } from './MermaidViewer';

const state = vi.hoisted(() => ({ error: vi.fn() }));
const ThemeContext = createContext(false);
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));
vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: () => ({ isDarkMode: useContext(ThemeContext) }),
}));
vi.mock('~/utils/logger', () => ({ default: () => ({ error: state.error }) }));

const initializationCalls = [...vi.mocked(mermaid.initialize).mock.calls];

const result = (text = 'current'): RenderResult => ({
  svg: `<svg><text>${text}</text></svg>`,
  diagramType: 'flowchart-v2',
});
const deferred: Array<ReturnType<typeof Promise.withResolvers<RenderResult>>> =
  [];
const deferRender = () => {
  const pending = Promise.withResolvers<RenderResult>();
  deferred.push(pending);
  vi.mocked(mermaid.render).mockReturnValueOnce(pending.promise);
  return pending;
};
const flush = async () => {
  await act(async () => {});
};
const frame = async () => {
  await act(() => {
    vi.runAllTimers();
  });
};
const status = (container: HTMLElement) =>
  container.firstElementChild?.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(mermaid.initialize).mockReset();
  vi.mocked(mermaid.render).mockReset().mockResolvedValue(result());
  state.error.mockClear();
});

afterEach(async () => {
  cleanup();
  for (const pending of deferred.splice(0)) pending.resolve(result());
  await flush();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MermaidViewer', () => {
  it('initializes once at module load, not when viewers mount or update', async () => {
    expect(initializationCalls).toEqual([[{}]]);
    const { rerender } = render(
      <>
        <MermaidViewer value="first" />
        <MermaidViewer value="second" />
      </>,
    );
    await flush();
    rerender(
      <ThemeContext.Provider value={true}>
        <MermaidViewer value="updated" />
      </ThemeContext.Provider>,
    );
    await flush();
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });

  it('marks rendering immediately and completes only on the next frame', async () => {
    const pending = deferRender();
    const { container } = render(<MermaidViewer value="graph TD; A-->B" />);
    expect(status(container)).toBe('true');
    pending.resolve(result());
    await flush();
    expect(container.querySelector('svg')).toHaveTextContent('current');
    expect(status(container)).toBe('true');
    await frame();
    expect(status(container)).toBe('false');
  });

  it('re-arms completion status for a theme change using the same container', async () => {
    const { container, rerender } = render(
      <ThemeContext.Provider value={false}>
        <MermaidViewer value="graph TD; A-->B" />
      </ThemeContext.Provider>,
    );
    await flush();
    await frame();
    const element = container.firstElementChild;
    const pending = deferRender();
    rerender(
      <ThemeContext.Provider value={true}>
        <MermaidViewer value="graph TD; A-->B" />
      </ThemeContext.Provider>,
    );
    expect(container.firstElementChild).toBe(element);
    expect(status(container)).toBe('true');
    pending.resolve(result('dark'));
    await flush();
    expect(mermaid.render).toHaveBeenLastCalledWith(
      expect.any(String),
      '%%{init: {"theme": "dark"}}%%\ngraph TD; A-->B',
      element,
    );
    expect(mermaid.initialize).not.toHaveBeenCalled();
    expect(status(container)).toBe('true');
    await frame();
    expect(status(container)).toBe('false');
  });

  it('keeps the latest source even when obsolete results arrive later', async () => {
    const old = deferRender();
    const intermediate = deferRender();
    const latest = deferRender();
    const { container, rerender } = render(<MermaidViewer value="old" />);
    rerender(<MermaidViewer value="intermediate" />);
    rerender(<MermaidViewer value="latest" />);
    expect(status(container)).toBe('true');
    latest.resolve(result('latest'));
    await flush();
    await frame();
    old.resolve(result('obsolete'));
    intermediate.resolve(result('intermediate'));
    await flush();
    await frame();
    expect(container.querySelector('svg')).toHaveTextContent('latest');
    expect(container).not.toHaveTextContent('obsolete');
    expect(container).not.toHaveTextContent('intermediate');
    expect(status(container)).toBe('false');
  });

  it('does not overwrite a newer render using the same container after a theme change', async () => {
    const old = deferRender();
    const { container, rerender } = render(
      <ThemeContext.Provider value={false}>
        <MermaidViewer value="unchanged source" />
      </ThemeContext.Provider>,
    );
    const element = container.firstElementChild;
    const latest = Promise.withResolvers<RenderResult>();
    deferred.push(latest);
    vi.mocked(mermaid.render).mockImplementationOnce((_id, _source, target) => {
      if (target) target.innerHTML = '<svg><text>In progress</text></svg>';
      return latest.promise;
    });
    rerender(
      <ThemeContext.Provider value={true}>
        <MermaidViewer value="unchanged source" />
      </ThemeContext.Provider>,
    );
    expect(container.firstElementChild).toBe(element);
    old.resolve(result('obsolete'));
    await flush();
    expect(element).toHaveTextContent('In progress');
    expect(status(container)).toBe('true');
    latest.resolve(result('latest dark'));
    await flush();
    await frame();
    expect(element).toHaveTextContent('latest dark');
    expect(status(container)).toBe('false');
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('ignores an unresolved render after unmount: %s', async (settlement) => {
    const pending = deferRender();
    const { container, unmount } = render(<MermaidViewer value="old" />);
    const element = container.firstElementChild;
    unmount();
    if (settlement === 'resolve') pending.resolve(result('obsolete'));
    else pending.reject(new Error('obsolete'));
    await flush();
    await frame();
    expect(element).not.toHaveTextContent('obsolete');
    expect(state.error).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('suppresses obsolete errors while a replacement is pending', async () => {
    const old = deferRender();
    const latest = deferRender();
    const { container, rerender } = render(<MermaidViewer value="old" />);
    rerender(<MermaidViewer value="latest" />);
    old.reject(new Error('obsolete'));
    await flush();
    expect(state.error).not.toHaveBeenCalled();
    expect(status(container)).toBe('true');
    latest.resolve(result('latest'));
    await flush();
  });

  it('preserves the error diagram and completes immediately on active failure', async () => {
    const error = new Error('invalid source');
    vi.mocked(mermaid.render).mockImplementationOnce(
      (_id, _source, element) => {
        if (element) element.innerHTML = '<svg><text>Syntax error</text></svg>';
        return Promise.reject(error);
      },
    );
    const { container } = render(<MermaidViewer value="invalid" />);
    await flush();
    expect(container).toHaveTextContent('Syntax error');
    expect(status(container)).toBe('false');
    expect(state.error).toHaveBeenCalledWith(error);
  });

  it('completes on a synchronous render error', async () => {
    vi.mocked(mermaid.render).mockImplementationOnce(() => {
      throw new Error('render failed');
    });
    const { container } = render(<MermaidViewer value="graph TD; A-->B" />);
    await flush();
    expect(status(container)).toBe('false');
    expect(state.error).toHaveBeenCalledOnce();
  });

  it('cancels the previous completion frame when source changes', async () => {
    const { container, rerender } = render(<MermaidViewer value="old" />);
    await flush();
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const pending = deferRender();
    rerender(<MermaidViewer value="new" />);
    await frame();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(status(container)).toBe('true');
    pending.resolve(result('new'));
    await flush();
    await frame();
    expect(status(container)).toBe('false');
  });

  it('cancels the completion frame on unmount', async () => {
    const { unmount } = render(<MermaidViewer value="graph TD; A-->B" />);
    await flush();
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    unmount();
    expect(cancelFrame).toHaveBeenCalledOnce();
    await frame();
    expect(state.error).not.toHaveBeenCalled();
  });

  it('ignores an obsolete completion callback even if it is already being delivered', async () => {
    const frames = vi.spyOn(window, 'requestAnimationFrame');
    const { container, rerender } = render(<MermaidViewer value="old" />);
    await flush();
    const callback = frames.mock.calls[0][0];
    const pending = deferRender();
    rerender(<MermaidViewer value="latest" />);
    act(() => callback(0));
    expect(status(container)).toBe('true');
    pending.resolve(result('latest'));
    await flush();
    await frame();
    expect(status(container)).toBe('false');
  });

  it('ignores the obsolete Strict Mode effect and publishes its replacement', async () => {
    const first = deferRender();
    const second = deferRender();
    const { container } = render(
      <StrictMode>
        <MermaidViewer value="graph TD; A-->B" />
      </StrictMode>,
    );
    first.resolve(result('obsolete'));
    await flush();
    expect(container).not.toHaveTextContent('obsolete');
    expect(mermaid.initialize).not.toHaveBeenCalled();
    second.resolve(result('current'));
    await flush();
    await frame();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container).toHaveTextContent('current');
    expect(status(container)).toBe('false');
  });

  it('renders multiple viewer instances with unique SVG IDs', async () => {
    const first = deferRender();
    const { container } = render(
      <>
        <MermaidViewer value="first" />
        <MermaidViewer value="second" />
      </>,
    );
    first.resolve(result('first'));
    await flush();
    await frame();
    expect(container.querySelectorAll('svg')).toHaveLength(2);
    expect(
      container.querySelectorAll(`[${GROWI_IS_CONTENT_RENDERING_ATTR}="true"]`),
    ).toHaveLength(0);
    const ids = vi.mocked(mermaid.render).mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(2);
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('finishes a disconnected current container without publishing: %s', async (settlement) => {
    const pending = deferRender();
    const { container } = render(<MermaidViewer value="source" />);
    const element = container.firstElementChild;
    expect(element).not.toBeNull();
    element?.remove();
    if (settlement === 'resolve') pending.resolve(result('obsolete'));
    else pending.reject(new Error('disconnected'));
    await flush();
    await frame();
    expect(element).not.toHaveTextContent('obsolete');
    expect(element).toHaveAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');
    expect(state.error).not.toHaveBeenCalled();
    if (element) container.append(element);
  });

  it('preserves an explicit frontmatter theme during a dark-mode render', async () => {
    const source = '---\nconfig:\n  theme: forest\n---\nflowchart TD\nA --> B';
    render(
      <ThemeContext.Provider value={true}>
        <MermaidViewer value={source} />
      </ThemeContext.Provider>,
    );
    await flush();
    expect(mermaid.render).toHaveBeenCalledWith(
      expect.any(String),
      source,
      expect.any(HTMLDivElement),
    );
    expect(mermaid.initialize).not.toHaveBeenCalled();
  });
});
