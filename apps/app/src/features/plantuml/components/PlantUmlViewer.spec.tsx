import type { ReactNode } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rendererConfigAtom } from '~/states/server-configurations';

import {
  fetchPlantumlSvg,
  type PlantumlSvgResult,
} from '../client/services/fetch-plantuml-svg';
import { PLANTUML_GET_URL_LIKELY_TOO_LONG } from '../interfaces/http-method';
import { PlantUmlViewer } from './PlantUmlViewer';

const state = vi.hoisted(() => ({ warn: vi.fn() }));

// Render i18n keys verbatim so assertions target which message is shown, not its copy.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/utils/logger', () => ({ default: () => ({ warn: state.warn }) }));
vi.mock('../client/services/fetch-plantuml-svg', () => ({
  fetchPlantumlSvg: vi.fn(),
}));

const SRC_PREFIX = 'http://example.com/plantuml/svg/';

const CONFIGURED_PLANTUML_URI = 'https://configured-plantuml.example.test/puml';

const SOURCE = '@startuml\nAlice -> Bob : hello\n@enduml';

const srcOfLength = (length: number): string =>
  SRC_PREFIX + 'a'.repeat(length - SRC_PREFIX.length);

const getRenderingStatus = (container: HTMLElement): string | null =>
  (container.firstElementChild as HTMLElement).getAttribute(
    GROWI_IS_CONTENT_RENDERING_ATTR,
  );

const renderWithConfig = (ui: ReactNode) => {
  const store = createStore();
  store.set(rendererConfigAtom, {
    ...store.get(rendererConfigAtom),
    plantumlUri: CONFIGURED_PLANTUML_URI,
    plantumlHttpMethod: 'post',
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return render(ui, { wrapper: Wrapper });
};

const svgBlob = (): Blob =>
  new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {
    type: 'image/svg+xml',
  });

const deferFetch = () => {
  const pending = Promise.withResolvers<PlantumlSvgResult>();
  vi.mocked(fetchPlantumlSvg).mockReturnValueOnce(pending.promise);
  return pending;
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let blobUrlCount = 0;
const createObjectURL = vi.fn((_blob: Blob) => {
  blobUrlCount += 1;
  return `blob:test/${blobUrlCount}`;
});
const revokeObjectURL = vi.fn((_url: string) => {});

beforeEach(() => {
  vi.clearAllMocks();
  blobUrlCount = 0;
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  vi.mocked(fetchPlantumlSvg).mockResolvedValue({ ok: true, blob: svgBlob() });
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('PlantUmlViewer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should render with rendering-status attribute set to "true" initially', () => {
    const { container } = renderWithConfig(
      <PlantUmlViewer src="http://example.com/plantuml.png" />,
    );
    expect(getRenderingStatus(container)).toBe('true');
  });

  it('should render an img element with the provided src', () => {
    renderWithConfig(<PlantUmlViewer src="http://example.com/diagram.png" />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('http://example.com/diagram.png');
  });

  describe('when the image loads', () => {
    it('should keep showing the image and set rendering-status to "false"', () => {
      const { container } = renderWithConfig(
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
      const { container } = renderWithConfig(<PlantUmlViewer src={src} />);

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
      const { container } = renderWithConfig(<PlantUmlViewer src={src} />);

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
      const { container, rerender } = renderWithConfig(
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
    const { container } = renderWithConfig(
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

  describe('POST (source)', () => {
    it('should take the destination only from the renderer config and ignore src', async () => {
      const { container } = renderWithConfig(
        <PlantUmlViewer
          source={SOURCE}
          src="https://attacker.example.test/svg/abc"
        />,
      );

      expect(fetchPlantumlSvg).toHaveBeenCalledTimes(1);
      expect(fetchPlantumlSvg).toHaveBeenCalledWith(
        CONFIGURED_PLANTUML_URI,
        SOURCE,
      );
      const img = await waitFor(() => {
        const found = container.querySelector('img');
        expect(found).not.toBeNull();
        return found as HTMLImageElement;
      });
      expect(img.getAttribute('src')).toBe('blob:test/1');
    });

    it('should show nothing and keep rendering-status "true" while fetching', () => {
      deferFetch();
      const { container } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} />,
      );

      expect(container.querySelector('img')).toBeNull();
      expect(screen.queryByText(/^plantuml\./)).toBeNull();
      expect(getRenderingStatus(container)).toBe('true');
    });

    it('should show the fetched SVG through a blob URL and set rendering-status to "false" after it loads', async () => {
      const blob = svgBlob();
      vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({ ok: true, blob });
      const { container } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} />,
      );

      const img = await waitFor(() => {
        const found = container.querySelector('img');
        expect(found).not.toBeNull();
        return found as HTMLImageElement;
      });
      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(img.getAttribute('src')).toBe('blob:test/1');
      expect(getRenderingStatus(container)).toBe('true');

      fireEvent.load(img);

      expect(getRenderingStatus(container)).toBe('false');
      expect(state.warn).not.toHaveBeenCalled();
    });

    it('should revoke the blob URL on unmount', async () => {
      const { container, unmount } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} />,
      );
      await waitFor(() => {
        expect(container.querySelector('img')).not.toBeNull();
      });
      expect(revokeObjectURL).not.toHaveBeenCalled();

      unmount();

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
    });

    it('should revoke the old blob URL and show the new diagram when the source changes', async () => {
      const { container, rerender } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} />,
      );
      await waitFor(() => {
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
          'blob:test/1',
        );
      });

      const newFetch = deferFetch();
      rerender(<PlantUmlViewer source={`${SOURCE}\n' changed`} />);

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
      // The revoked URL must not stay on screen while the new source loads.
      expect(container.querySelector('img')).toBeNull();

      await act(async () => {
        newFetch.resolve({ ok: true, blob: svgBlob() });
        await newFetch.promise;
      });
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'blob:test/2',
      );
      expect(screen.queryByText(/^plantuml\./)).toBeNull();
    });

    it('should not show the revoked blob URL when the source returns to an earlier value', async () => {
      const { container, rerender } = renderWithConfig(
        <PlantUmlViewer source="a" />,
      );
      await waitFor(() => {
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
          'blob:test/1',
        );
      });
      deferFetch();
      const refetch = deferFetch();

      rerender(<PlantUmlViewer source="b" />);
      rerender(<PlantUmlViewer source="a" />);

      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
      expect(container.querySelector('img')).toBeNull();

      await act(async () => {
        refetch.resolve({ ok: true, blob: svgBlob() });
        await refetch.promise;
      });
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'blob:test/2',
      );
    });

    it('should discard a result for an old source that arrives after the source changed', async () => {
      const oldFetch = deferFetch();
      const newFetch = deferFetch();
      const { container, rerender } = renderWithConfig(
        <PlantUmlViewer source="old" />,
      );
      rerender(<PlantUmlViewer source="new" />);

      const newBlob = svgBlob();
      await act(async () => {
        newFetch.resolve({ ok: true, blob: newBlob });
        await newFetch.promise;
      });
      await act(async () => {
        oldFetch.resolve({ ok: true, blob: svgBlob() });
        await oldFetch.promise;
      });

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledWith(newBlob);
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'blob:test/1',
      );
    });

    it('should not show a stale failure for an old source', async () => {
      const oldFetch = deferFetch();
      const newFetch = deferFetch();
      const { container, rerender } = renderWithConfig(
        <PlantUmlViewer source="old" />,
      );
      rerender(<PlantUmlViewer source="new" />);

      await act(async () => {
        oldFetch.resolve({ ok: false, reason: 'post-unavailable' });
        await oldFetch.promise;
      });

      expect(screen.queryByText(/^plantuml\./)).toBeNull();
      expect(state.warn).not.toHaveBeenCalled();

      await act(async () => {
        newFetch.resolve({ ok: true, blob: svgBlob() });
        await newFetch.promise;
      });
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'blob:test/1',
      );
    });

    describe('when the fetch fails', () => {
      it.each([
        { reason: 'post-unavailable', status: undefined },
        { reason: 'render-failed', status: 500 },
      ] as const)('should show the $reason message, set rendering-status to "false" and warn', async ({
        reason,
        status,
      }) => {
        vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({
          ok: false,
          reason,
          status,
        });
        const { container } = renderWithConfig(
          <PlantUmlViewer source={SOURCE} />,
        );

        const message = await screen.findByText(`plantuml.${reason}`);

        const diagramContainer = container.firstElementChild as HTMLElement;
        expect(diagramContainer).toContainElement(message);
        expect(diagramContainer.querySelector('img')).toBeNull();
        expect(getRenderingStatus(container)).toBe('false');
        expect(state.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            reason,
            method: 'post',
            sourceLength: SOURCE.length,
            status,
          }),
          expect.any(String),
        );
        expect(createObjectURL).not.toHaveBeenCalled();
      });
    });

    describe('when the blob URL image fails to load', () => {
      it('should show the render-failed message, set rendering-status to "false" and warn', async () => {
        const { container } = renderWithConfig(
          <PlantUmlViewer source={SOURCE} />,
        );
        const img = await waitFor(() => {
          const found = container.querySelector('img');
          expect(found).not.toBeNull();
          return found as HTMLImageElement;
        });

        fireEvent.error(img);

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('plantuml.render-failed')).not.toBeNull();
        expect(getRenderingStatus(container)).toBe('false');
        expect(state.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'render-failed',
            method: 'post',
            sourceLength: SOURCE.length,
          }),
          expect.any(String),
        );
      });
    });
  });
});
