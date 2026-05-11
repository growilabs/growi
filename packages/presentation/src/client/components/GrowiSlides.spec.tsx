import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GrowiSlides } from './GrowiSlides';

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

describe('GrowiSlides', () => {
  it('does not throw when rendererOptions is undefined', () => {
    expect(() =>
      render(
        <GrowiSlides options={{ rendererOptions: undefined as any }}>
          {'# Slide'}
        </GrowiSlides>,
      ),
    ).not.toThrow();
  });

  it('does not throw when rendererOptions is null', () => {
    expect(() =>
      render(
        <GrowiSlides options={{ rendererOptions: null as any }}>
          {'# Slide'}
        </GrowiSlides>,
      ),
    ).not.toThrow();
  });

  it('renders nothing when rendererOptions is null', () => {
    const { container } = render(
      <GrowiSlides options={{ rendererOptions: null as any }}>
        {'# Slide'}
      </GrowiSlides>,
    );
    expect(container.firstChild).toBeNull();
  });
});
