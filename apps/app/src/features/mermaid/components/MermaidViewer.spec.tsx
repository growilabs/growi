import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock mermaid to control rendering behavior in tests
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

// Mock useNextThemes to provide a stable isDarkMode value
vi.mock('~/stores-universal/use-next-themes', () => ({
  useNextThemes: vi.fn(() => ({ isDarkMode: false })),
}));

// uuid mock: return predictable IDs
vi.mock('uuid', () => ({
  v7: vi.fn(() => 'test-uuid'),
}));

import mermaid from 'mermaid';

import { MermaidViewer } from './MermaidViewer';

const mockRender = vi.mocked(mermaid.render);

describe('MermaidViewer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('should render container with rendering-status attribute set to "true" initially', () => {
    mockRender.mockReturnValue(new Promise(() => {})); // pending — never resolves

    const { container } = render(<MermaidViewer value="graph TD; A-->B" />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');
  });

  it('should set rendering-status attribute to "false" via requestAnimationFrame after successful render', async () => {
    mockRender.mockResolvedValue({
      svg: '<svg>test</svg>',
      bindFunctions: undefined as never,
      diagramType: 'flowchart',
    });

    const { container } = render(<MermaidViewer value="graph TD; A-->B" />);
    const div = container.firstElementChild as HTMLElement;

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');

    // Flush the async mermaid.render() call
    await act(async () => {
      await Promise.resolve();
    });

    // Attribute should still be "true" — waiting for rAF
    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');

    // Flush the requestAnimationFrame
    await act(() => {
      vi.runAllTimers();
    });

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('false');
  });

  it('should set rendering-status attribute to "false" immediately on error (no rAF delay)', async () => {
    mockRender.mockRejectedValue(new Error('Mermaid render failed'));

    const { container } = render(
      <MermaidViewer value="invalid mermaid syntax ###" />,
    );
    const div = container.firstElementChild as HTMLElement;

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');

    // Flush the rejected promise
    await act(async () => {
      await Promise.resolve();
    });

    expect(div.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('false');
  });

  it('should cancel pending requestAnimationFrame when component unmounts during render', async () => {
    let resolveRender!: (value: {
      svg: string;
      bindFunctions: never;
      diagramType: string;
    }) => void;
    mockRender.mockReturnValue(
      new Promise<{ svg: string; bindFunctions: never; diagramType: string }>(
        (resolve) => {
          resolveRender = resolve;
        },
      ),
    );

    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const { unmount } = render(<MermaidViewer value="graph TD; A-->B" />);

    // Resolve render but don't flush rAF yet
    await act(async () => {
      resolveRender({
        svg: '<svg>test</svg>',
        bindFunctions: undefined as never,
        diagramType: 'flowchart',
      });
      await Promise.resolve();
    });

    // Unmount before rAF fires
    unmount();

    // Verify cancelAnimationFrame was called
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();

    // Advancing timers should not cause errors (no DOM update on unmounted component)
    await act(() => {
      vi.runAllTimers();
    });
  });
});
