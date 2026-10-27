import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GrowiSlides } from './GrowiSlides.js';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../consts/marpit-base-css.vendor-styles.prebuilt', () => ({
  PRESENTATION_MARPIT_CSS: '',
  SLIDE_MARPIT_CSS: '',
}));

vi.mock('../services/renderer/extract-sections', () => ({
  remarkPlugin: vi.fn(),
}));

vi.mock('./RichSlideSection', () => ({
  RichSlideSection: () => <div />,
  PresentationRichSlideSection: () => <div />,
}));

const validRendererOptions = {
  remarkPlugins: [],
  rehypePlugins: [],
  components: {},
};

describe('GrowiSlides', () => {
  it('does not throw when rendererOptions is undefined', () => {
    expect(() =>
      render(
        <GrowiSlides options={{ rendererOptions: undefined }}>
          {'# Slide'}
        </GrowiSlides>,
      ),
    ).not.toThrow();
  });

  it('renders nothing when rendererOptions is undefined', () => {
    const { container } = render(
      <GrowiSlides options={{ rendererOptions: undefined }}>
        {'# Slide'}
      </GrowiSlides>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders slides content when rendererOptions is valid', () => {
    render(
      <GrowiSlides options={{ rendererOptions: validRendererOptions }}>
        {'# Slide 1'}
      </GrowiSlides>,
    );
    expect(screen.queryByText('Slide 1')).toBeTruthy();
  });
});
