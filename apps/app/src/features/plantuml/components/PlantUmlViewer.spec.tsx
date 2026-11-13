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

import type { RendererConfig } from '~/interfaces/services/renderer';
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

const renderWithConfig = (
  ui: ReactNode,
  config: Partial<RendererConfig> = {},
) => {
  const store = createStore();
  store.set(rendererConfigAtom, {
    ...store.get(rendererConfigAtom),
    plantumlUri: CONFIGURED_PLANTUML_URI,
    plantumlHttpMethod: 'get',
    ...config,
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return render(ui, { wrapper: Wrapper });
};

const renderWithPost = (ui: ReactNode) =>
  renderWithConfig(ui, { plantumlHttpMethod: 'post' });

// Distinct per label, so a test can tell which result is on screen.
const svgDataUrl = (label: string): string =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`)}`;

const DEFAULT_DATA_URL = svgDataUrl('default');

const deferFetch = () => {
  const pending = Promise.withResolvers<PlantumlSvgResult>();
  vi.mocked(fetchPlantumlSvg).mockReturnValueOnce(pending.promise);
  return pending;
};

const findImg = (container: HTMLElement): Promise<HTMLImageElement> =>
  waitFor(() => {
    const found = container.querySelector('img');
    expect(found).not.toBeNull();
    return found as HTMLImageElement;
  });

// Stubbed so any use would be visible (research.md "SVG は blob URL でなく data URL で表示する").
const originalCreateObjectURL = URL.createObjectURL;
const createObjectURL = vi.fn((_blob: Blob) => 'blob:test/created');

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = createObjectURL;
  vi.mocked(fetchPlantumlSvg).mockResolvedValue({
    ok: true,
    dataUrl: DEFAULT_DATA_URL,
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
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

  // Page authors can hand-write a source attribute, so it alone must not select POST.
  describe('choosing between GET and POST', () => {
    it('should send nothing and render nothing for a source-only element when the method is GET', async () => {
      const { container } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} />,
      );

      await act(async () => {});

      expect(fetchPlantumlSvg).not.toHaveBeenCalled();
      expect(container.innerHTML).toBe('');
    });

    it('should show the src image without fetching when the method is GET and both attributes are present', async () => {
      const src = 'http://example.com/plantuml/svg/abc';
      const { container } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} src={src} />,
      );

      await act(async () => {});

      expect(fetchPlantumlSvg).not.toHaveBeenCalled();
      expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
    });

    it('should show the src image without fetching when the method is POST and only src is present', async () => {
      const src = 'http://example.com/plantuml/svg/abc';
      const { container } = renderWithPost(<PlantUmlViewer src={src} />);

      await act(async () => {});

      expect(fetchPlantumlSvg).not.toHaveBeenCalled();
      expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
    });

    it('should send nothing and render nothing when the method is POST but no destination is configured', async () => {
      const { container } = renderWithConfig(
        <PlantUmlViewer source={SOURCE} />,
        { plantumlHttpMethod: 'post', plantumlUri: '' },
      );

      await act(async () => {});

      expect(fetchPlantumlSvg).not.toHaveBeenCalled();
      expect(container.innerHTML).toBe('');
    });

    it('should fetch the source from the configured destination when the method is POST', async () => {
      const { container } = renderWithPost(<PlantUmlViewer source={SOURCE} />);

      const img = await findImg(container);

      expect(fetchPlantumlSvg).toHaveBeenCalledWith(
        CONFIGURED_PLANTUML_URI,
        SOURCE,
      );
      expect(img.getAttribute('src')).toBe(DEFAULT_DATA_URL);
    });
  });

  describe('POST (source)', () => {
    it('should take the destination only from the renderer config and ignore src', async () => {
      const { container } = renderWithPost(
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
      const img = await findImg(container);
      expect(img.getAttribute('src')).toBe(DEFAULT_DATA_URL);
    });

    it('should show nothing and keep rendering-status "true" while fetching', () => {
      deferFetch();
      const { container } = renderWithPost(<PlantUmlViewer source={SOURCE} />);

      expect(container.querySelector('img')).toBeNull();
      expect(screen.queryByText(/^plantuml\./)).toBeNull();
      expect(getRenderingStatus(container)).toBe('true');
    });

    it('should show the fetched SVG data URL and set rendering-status to "false" after it loads', async () => {
      const dataUrl = svgDataUrl('fetched');
      vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({ ok: true, dataUrl });
      const { container } = renderWithPost(<PlantUmlViewer source={SOURCE} />);

      const img = await findImg(container);
      expect(img.getAttribute('src')).toBe(dataUrl);
      expect(getRenderingStatus(container)).toBe('true');

      fireEvent.load(img);

      expect(getRenderingStatus(container)).toBe('false');
      expect(state.warn).not.toHaveBeenCalled();
    });

    it('should never show the fetched SVG through a blob URL', async () => {
      const { container } = renderWithPost(<PlantUmlViewer source={SOURCE} />);

      const img = await findImg(container);

      expect(img.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(
        true,
      );
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('should keep showing the old diagram while the new source loads, then show the new one', async () => {
      const { container, rerender } = renderWithPost(
        <PlantUmlViewer source={SOURCE} />,
      );
      await waitFor(() => {
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
          DEFAULT_DATA_URL,
        );
      });

      const newFetch = deferFetch();
      rerender(<PlantUmlViewer source={`${SOURCE}\n' changed`} />);

      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        DEFAULT_DATA_URL,
      );

      const changedDataUrl = svgDataUrl('changed');
      await act(async () => {
        newFetch.resolve({ ok: true, dataUrl: changedDataUrl });
        await newFetch.promise;
      });
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        changedDataUrl,
      );
      expect(screen.queryByText(/^plantuml\./)).toBeNull();
    });

    it('should show the refetched result when the source returns to an earlier value', async () => {
      vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({
        ok: true,
        dataUrl: svgDataUrl('a'),
      });
      const { container, rerender } = renderWithPost(
        <PlantUmlViewer source="a" />,
      );
      await waitFor(() => {
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
          svgDataUrl('a'),
        );
      });
      const bFetch = deferFetch();
      const refetch = deferFetch();

      rerender(<PlantUmlViewer source="b" />);
      rerender(<PlantUmlViewer source="a" />);

      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        svgDataUrl('a'),
      );

      const refetchedDataUrl = svgDataUrl('a refetched');
      await act(async () => {
        refetch.resolve({ ok: true, dataUrl: refetchedDataUrl });
        await refetch.promise;
      });
      await act(async () => {
        bFetch.resolve({ ok: true, dataUrl: svgDataUrl('b') });
        await bFetch.promise;
      });
      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        refetchedDataUrl,
      );
    });

    it('should discard a result for an old source that arrives after the source changed', async () => {
      const oldFetch = deferFetch();
      const newFetch = deferFetch();
      const { container, rerender } = renderWithPost(
        <PlantUmlViewer source="old" />,
      );
      rerender(<PlantUmlViewer source="new" />);

      const newDataUrl = svgDataUrl('new');
      await act(async () => {
        newFetch.resolve({ ok: true, dataUrl: newDataUrl });
        await newFetch.promise;
      });
      await act(async () => {
        oldFetch.resolve({ ok: true, dataUrl: svgDataUrl('old') });
        await oldFetch.promise;
      });

      expect(container.querySelectorAll('img')).toHaveLength(1);
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        newDataUrl,
      );
    });

    it('should not show a stale failure for an old source', async () => {
      const oldFetch = deferFetch();
      const newFetch = deferFetch();
      const { container, rerender } = renderWithPost(
        <PlantUmlViewer source="old" />,
      );
      rerender(<PlantUmlViewer source="new" />);

      await act(async () => {
        oldFetch.resolve({ ok: false, reason: 'post-unavailable' });
        await oldFetch.promise;
      });

      expect(screen.queryByText(/^plantuml\./)).toBeNull();
      expect(state.warn).not.toHaveBeenCalled();

      const newDataUrl = svgDataUrl('new');
      await act(async () => {
        newFetch.resolve({ ok: true, dataUrl: newDataUrl });
        await newFetch.promise;
      });
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        newDataUrl,
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
        const { container } = renderWithPost(
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
      });

      it('should stop showing the failure as soon as the source changes', async () => {
        vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({
          ok: false,
          reason: 'post-unavailable',
        });
        const { container, rerender } = renderWithPost(
          <PlantUmlViewer source="a" />,
        );
        await screen.findByText('plantuml.post-unavailable');
        const newFetch = deferFetch();

        rerender(<PlantUmlViewer source="b" />);

        expect(screen.queryByText(/^plantuml\./)).toBeNull();
        expect(container.querySelector('img')).toBeNull();

        const newDataUrl = svgDataUrl('b');
        await act(async () => {
          newFetch.resolve({ ok: true, dataUrl: newDataUrl });
          await newFetch.promise;
        });
        expect(container.querySelector('img')?.getAttribute('src')).toBe(
          newDataUrl,
        );
      });
    });

    describe('when the data URL image fails to load', () => {
      it('should show the render-failed message, set rendering-status to "false" and warn', async () => {
        const { container } = renderWithPost(
          <PlantUmlViewer source={SOURCE} />,
        );
        const img = await findImg(container);

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

      it('should show the new diagram when the source changes to one with a different SVG', async () => {
        const { container, rerender } = renderWithPost(
          <PlantUmlViewer source={SOURCE} />,
        );
        fireEvent.error(await findImg(container));
        const fixedDataUrl = svgDataUrl('fixed');
        vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({
          ok: true,
          dataUrl: fixedDataUrl,
        });

        rerender(<PlantUmlViewer source={`${SOURCE}\n' fixed`} />);

        const img = await findImg(container);
        expect(img.getAttribute('src')).toBe(fixedDataUrl);
        expect(screen.queryByText(/^plantuml\./)).toBeNull();
      });

      // The same data URL is the same bytes, which would fail to load again.
      it('should keep showing the message when the source returns to one whose SVG failed', async () => {
        const { container, rerender } = renderWithPost(
          <PlantUmlViewer source="a" />,
        );
        fireEvent.error(await findImg(container));
        vi.mocked(fetchPlantumlSvg).mockResolvedValueOnce({
          ok: true,
          dataUrl: svgDataUrl('b'),
        });
        rerender(<PlantUmlViewer source="b" />);
        await waitFor(() => {
          expect(container.querySelector('img')?.getAttribute('src')).toBe(
            svgDataUrl('b'),
          );
        });

        rerender(<PlantUmlViewer source="a" />);

        expect(
          await screen.findByText('plantuml.render-failed'),
        ).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
      });
    });
  });
});
