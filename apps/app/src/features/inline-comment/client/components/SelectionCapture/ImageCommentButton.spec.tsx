import { createRef } from 'react';
import { GROWI_DECORATION_ATTR } from '@growi/core/dist/consts';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';

import { markImages } from '../../services/image-in-range';
import { IMAGE_TOKEN } from '../../services/rendered-text';
import { ImageCommentButton } from './ImageCommentButton';
import { captureRange } from './use-text-selection';

const isBlockedRef = vi.hoisted(() => ({ current: false }));
vi.mock('~/client/components/NotAvailableForReadOnlyUser', () => ({
  useIsCommentActionBlockedForReadOnlyUser: () => isBlockedRef.current,
}));

const mountBody = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  const containerRef = createRef<HTMLElement>();
  (containerRef as { current: HTMLElement | null }).current = container;
  return { container, containerRef };
};

const CONTENT_IMAGE_HTML =
  '<p>Before <button type="button"><img src="/a.png" alt="a"></button> after</p>';

const queryButton = () => screen.queryByTestId('selection-action-button');

const hover = (target: Element, pointerType = 'mouse') => {
  act(() => {
    fireEvent.pointerOver(target, { pointerType });
  });
};

beforeEach(() => {
  isBlockedRef.current = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('ImageCommentButton', () => {
  it('offers a comment on a hovered image, committing a range of exactly that image', () => {
    const { container, containerRef } = mountBody(CONTENT_IMAGE_HTML);
    const onCommit = vi.fn();
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={onCommit} />,
    );

    hover(container.querySelector('img') as HTMLImageElement);
    fireEvent.click(screen.getByTestId('selection-action-button'));

    expect(onCommit).toHaveBeenCalledTimes(1);
    const range: Range = onCommit.mock.calls[0][0];
    expect(captureRange(range, container)?.quote).toBe(IMAGE_TOKEN);
  });

  it('does not offer a comment for a touch pointer', () => {
    const { container, containerRef } = mountBody(CONTENT_IMAGE_HTML);
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={vi.fn()} />,
    );

    hover(container.querySelector('img') as HTMLImageElement, 'touch');

    expect(queryButton()).toBeNull();
  });

  it('does not offer a comment on an image that already has a saved comment', () => {
    const { container, containerRef } = mountBody(CONTENT_IMAGE_HTML);
    const image = container.querySelector('img') as HTMLImageElement;
    markImages([image], 'saved');
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={vi.fn()} />,
    );

    hover(image);

    expect(queryButton()).toBeNull();
  });

  it('does not offer a comment on a decoration image', () => {
    const { container, containerRef } = mountBody(
      `<p>Card <span ${GROWI_DECORATION_ATTR}><img src="/avatar.png" alt="Alice"></span></p>`,
    );
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={vi.fn()} />,
    );

    hover(container.querySelector('img') as HTMLImageElement);

    expect(queryButton()).toBeNull();
  });

  it('does not offer a comment to a user who may not comment', () => {
    isBlockedRef.current = true;
    const { container, containerRef } = mountBody(CONTENT_IMAGE_HTML);
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={vi.fn()} />,
    );

    hover(container.querySelector('img') as HTMLImageElement);

    expect(queryButton()).toBeNull();
  });

  it('closes on Escape', () => {
    const { container, containerRef } = mountBody(CONTENT_IMAGE_HTML);
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={vi.fn()} />,
    );
    hover(container.querySelector('img') as HTMLImageElement);

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(queryButton()).toBeNull();
  });

  it('stays while the pointer moves from the image onto the button, and closes a moment after the pointer leaves both', () => {
    vi.useFakeTimers();
    const { container, containerRef } = mountBody(CONTENT_IMAGE_HTML);
    render(
      <ImageCommentButton containerRef={containerRef} onCommit={vi.fn()} />,
    );
    const image = container.querySelector('img') as HTMLImageElement;
    hover(image);
    const button = screen.getByTestId('selection-action-button');

    act(() => {
      fireEvent.pointerOut(image, {
        pointerType: 'mouse',
        relatedTarget: button,
      });
      fireEvent.pointerEnter(button, { pointerType: 'mouse' });
      vi.advanceTimersByTime(1000);
    });
    expect(queryButton()).not.toBeNull();

    act(() => {
      fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    });
    expect(queryButton()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(queryButton()).toBeNull();
  });
});
