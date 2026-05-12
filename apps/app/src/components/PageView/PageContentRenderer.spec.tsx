import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RendererOptions } from '~/interfaces/renderer-options';
import { RehypeSanitizeType } from '~/interfaces/services/rehype-sanitize';
import type { RendererConfig } from '~/interfaces/services/renderer';

const { mockGeneratedOptions, MockRevisionRenderer } = vi.hoisted(() => {
  const mockGeneratedOptions: RendererOptions = {
    remarkPlugins: [],
    rehypePlugins: [],
    components: {},
  };
  const MockRevisionRenderer = vi.fn(({ markdown }: { markdown: string }) => (
    <div data-testid="revision-renderer">{markdown}</div>
  ));
  return { mockGeneratedOptions, MockRevisionRenderer };
});

// Mock the server renderer to avoid importing the full markdown pipeline in tests
vi.mock('~/services/renderer/renderer', () => ({
  generateSSRViewOptions: vi.fn(() => mockGeneratedOptions),
}));

// Mock RevisionRenderer to capture the props it receives
vi.mock('./RevisionRenderer', () => ({
  default: MockRevisionRenderer,
}));

import { generateSSRViewOptions } from '~/services/renderer/renderer';

import { PageContentRenderer } from './PageContentRenderer';

const mockRendererConfig: RendererConfig = {
  isEnabledLinebreaks: true,
  isEnabledLinebreaksInComments: true,
  adminPreferredIndentSize: 4,
  isIndentSizeForced: false,
  highlightJsStyleBorder: false,
  isEnabledMarp: false,
  isEnabledXssPrevention: true,
  sanitizeType: RehypeSanitizeType.RECOMMENDED,
  drawioUri: '',
  plantumlUri: '',
};

describe('PageContentRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when markdown is null', () => {
    const { container } = render(
      <PageContentRenderer
        rendererConfig={mockRendererConfig}
        pagePath="/test"
        markdown={null}
      />,
    );

    expect(container.innerHTML).toBe('');
    expect(generateSSRViewOptions).not.toHaveBeenCalled();
    expect(MockRevisionRenderer).not.toHaveBeenCalled();
  });

  it('generates options from rendererConfig and passes them to RevisionRenderer', () => {
    render(
      <PageContentRenderer
        rendererConfig={mockRendererConfig}
        pagePath="/test"
        markdown="# Hello"
      />,
    );

    expect(generateSSRViewOptions).toHaveBeenCalledWith(
      mockRendererConfig,
      '/test',
    );
    expect(MockRevisionRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        rendererOptions: mockGeneratedOptions,
        markdown: '# Hello',
      }),
      expect.anything(),
    );
  });

  it('uses provided rendererOptions without generating new ones', () => {
    const customOptions: RendererOptions = {
      remarkPlugins: [],
      rehypePlugins: [],
      components: { p: 'span' as never },
    };

    render(
      <PageContentRenderer
        rendererOptions={customOptions}
        rendererConfig={mockRendererConfig}
        pagePath="/test"
        markdown="**bold**"
      />,
    );

    expect(generateSSRViewOptions).not.toHaveBeenCalled();
    expect(MockRevisionRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        rendererOptions: customOptions,
        markdown: '**bold**',
      }),
      expect.anything(),
    );
  });
});
