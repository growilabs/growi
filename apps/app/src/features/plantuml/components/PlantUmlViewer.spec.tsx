import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLANTUML_GET_URL_LIKELY_TOO_LONG } from '../interfaces/http-method';
import { PlantUmlViewer } from './PlantUmlViewer';

const state = vi.hoisted(() => ({ warn: vi.fn() }));

// Render i18n keys verbatim so assertions target which message is shown, not its copy.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/utils/logger', () => ({ default: () => ({ warn: state.warn }) }));

const SRC_PREFIX = 'http://example.com/plantuml/svg/';

const srcOfLength = (length: number): string =>
  SRC_PREFIX + 'a'.repeat(length - SRC_PREFIX.length);

const getRenderingStatus = (container: HTMLElement): string | null =>
  (container.firstElementChild as HTMLElement).getAttribute(
    GROWI_IS_CONTENT_RENDERING_ATTR,
  );

describe('PlantUmlViewer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should render with rendering-status attribute set to "true" initially', () => {
    const { container } = render(
      <PlantUmlViewer src="http://example.com/plantuml.png" />,
    );
    expect(getRenderingStatus(container)).toBe('true');
  });

  it('should render an img element with the provided src', () => {
    render(<PlantUmlViewer src="http://example.com/diagram.png" />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('http://example.com/diagram.png');
  });

  describe('when the image loads', () => {
    it('should keep showing the image and set rendering-status to "false"', () => {
      const { container } = render(
        <PlantUmlViewer src="http://example.com/plantuml.png" />,
      );
      const img = container.querySelector('img') as HTMLImageElement;

      fireEvent.load(img);

      expect(container.querySelector('img')).not.toBeNull();
      expect(screen.queryByText(/^plantuml\./)).toBeNull();
      expect(getRenderingStatus(container)).toBe('false');
      expect(state.warn).not.toHaveBeenCalled();
    });
  });

  describe('when the image fails to load', () => {
    it.each([
      {
        length: PLANTUML_GET_URL_LIKELY_TOO_LONG - 1,
        reason: 'render-failed',
      },
      { length: PLANTUML_GET_URL_LIKELY_TOO_LONG, reason: 'url-too-long' },
      {
        length: PLANTUML_GET_URL_LIKELY_TOO_LONG + 1000,
        reason: 'url-too-long',
      },
    ])('should show the $reason message in place of the image for a $length-char src', ({
      length,
      reason,
    }) => {
      const src = srcOfLength(length);
      const { container } = render(<PlantUmlViewer src={src} />);

      fireEvent.error(container.querySelector('img') as HTMLImageElement);

      const diagramContainer = container.firstElementChild as HTMLElement;
      expect(diagramContainer.querySelector('img')).toBeNull();
      expect(diagramContainer).toContainElement(
        screen.getByText(`plantuml.${reason}`),
      );
      expect(getRenderingStatus(container)).toBe('false');
    });

    it('should warn on the console with the reason, method and URL length', () => {
      const src = srcOfLength(120);
      const { container } = render(<PlantUmlViewer src={src} />);

      fireEvent.error(container.querySelector('img') as HTMLImageElement);

      expect(state.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'render-failed',
          method: 'get',
          urlLength: src.length,
        }),
        expect.any(String),
      );
    });

    it('should try the new src again when src changes after a failure', () => {
      const { container, rerender } = render(
        <PlantUmlViewer src="http://example.com/broken.png" />,
      );
      fireEvent.error(container.querySelector('img') as HTMLImageElement);
      expect(container.querySelector('img')).toBeNull();

      rerender(<PlantUmlViewer src="http://example.com/fixed.png" />);

      const img = container.querySelector('img') as HTMLImageElement;
      expect(img.src).toBe('http://example.com/fixed.png');
      expect(screen.queryByText(/^plantuml\./)).toBeNull();
    });
  });

  it('should not affect other diagrams when one of them fails', () => {
    const { container } = render(
      <>
        <PlantUmlViewer src="http://example.com/broken.png" />
        <PlantUmlViewer src="http://example.com/ok.png" />
      </>,
    );
    const [failing, healthy] = Array.from(container.children) as HTMLElement[];

    fireEvent.error(failing.querySelector('img') as HTMLImageElement);

    expect(failing.querySelector('img')).toBeNull();
    expect(failing).toContainElement(
      screen.getByText('plantuml.render-failed'),
    );
    const healthyImg = healthy.querySelector('img') as HTMLImageElement;
    expect(healthyImg.src).toBe('http://example.com/ok.png');
    expect(healthy.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('true');

    fireEvent.load(healthyImg);

    expect(healthy.querySelector('img')).not.toBeNull();
    expect(healthy.getAttribute(GROWI_IS_CONTENT_RENDERING_ATTR)).toBe('false');
  });
});
