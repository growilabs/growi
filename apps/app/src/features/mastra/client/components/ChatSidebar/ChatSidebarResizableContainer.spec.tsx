// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { useHydrateAtoms } from 'jotai/utils';

import { scheduleToPut } from '~/client/services/user-ui-settings';
import {
  aiChatSidebarWidthAtom,
  CHAT_SIDEBAR_WIDTH_DEFAULT,
} from '~/features/mastra/states/chat-sidebar-width';

import { ChatSidebarResizableContainer } from './ChatSidebarResizableContainer';

const VIEWPORT_WIDTH = 1280;

// happy-dom performs no layout, so the viewport width the component reads has
// to be pinned explicitly (and can be changed per test).
const setViewportWidth = (width: number) => {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: width,
  });
};

const { deviceState } = vi.hoisted(() => ({
  deviceState: { isLargerThanSm: true },
}));
vi.mock('~/states/ui/device', () => ({
  useDeviceLargerThanSm: () => [deviceState.isLargerThanSm, vi.fn()] as const,
}));

vi.mock('~/client/services/user-ui-settings', () => ({
  scheduleToPut: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  deviceState.isLargerThanSm = true;
  setViewportWidth(VIEWPORT_WIDTH);
});

// Seeds the stored width the way the page hydration does
const HydrateStoredWidth = ({
  storedWidth,
  children,
}: {
  storedWidth?: number;
  children: ReactNode;
}) => {
  useHydrateAtoms([
    [aiChatSidebarWidthAtom, storedWidth ?? CHAT_SIDEBAR_WIDTH_DEFAULT],
  ]);
  return <>{children}</>;
};

const renderContainer = (storedWidth?: number) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider>
      <HydrateStoredWidth storedWidth={storedWidth}>
        {children}
      </HydrateStoredWidth>
    </Provider>
  );
  return render(
    <ChatSidebarResizableContainer>
      <div>content</div>
    </ChatSidebarResizableContainer>,
    { wrapper },
  );
};

// The resizable area is the element that directly wraps the children
const getResizableArea = (): HTMLElement => {
  const area = screen.getByText('content').parentElement;
  if (area == null) throw new Error('resizable area not rendered');
  return area;
};

const queryHandle = () =>
  screen.queryByRole('button', { name: 'Resize sidebar' });

describe('ChatSidebarResizableContainer', () => {
  describe('on a viewport at or above the sm breakpoint', () => {
    it('renders at the stored width with a resize handle', () => {
      renderContainer();

      expect(getResizableArea().style.width).toBe('500px');
      expect(queryHandle()).not.toBeNull();
    });

    it('keeps the resize handle reachable: the fixed root does not clip overflow and hosts the handle', () => {
      const { container } = renderContainer();
      const root = container.firstElementChild;

      expect(root?.classList.contains('position-fixed')).toBe(true);
      expect(root?.classList.contains('overflow-hidden')).toBe(false);
      expect(root?.contains(queryHandle())).toBe(true);
    });

    it('keeps the content clipped inside the panel', () => {
      renderContainer();

      expect(getResizableArea().classList.contains('overflow-hidden')).toBe(
        true,
      );
    });

    it('applies the dragged width and persists it on release', () => {
      renderContainer();
      const handle = queryHandle();
      if (handle == null) throw new Error('handle not rendered');

      fireEvent.mouseDown(handle, { clientX: VIEWPORT_WIDTH - 500 });
      fireEvent.mouseMove(document, { clientX: VIEWPORT_WIDTH - 640 });

      expect(getResizableArea().style.width).toBe('640px');
      expect(scheduleToPut).not.toHaveBeenCalled();

      fireEvent.mouseUp(document, { clientX: VIEWPORT_WIDTH - 640 });

      expect(getResizableArea().style.width).toBe('640px');
      expect(scheduleToPut).toHaveBeenCalledWith({ aiChatSidebarWidth: 640 });
    });

    it('does not grow beyond the viewport-based maximum while dragging', () => {
      setViewportWidth(1000);
      renderContainer();
      const handle = queryHandle();
      if (handle == null) throw new Error('handle not rendered');

      fireEvent.mouseDown(handle, { clientX: 500 });
      fireEvent.mouseMove(document, { clientX: 0 });
      fireEvent.mouseUp(document, { clientX: 0 });

      // min(960, 1000 - 320) = 680
      expect(getResizableArea().style.width).toBe('680px');
      expect(scheduleToPut).toHaveBeenCalledWith({ aiChatSidebarWidth: 680 });
    });

    it('renders a stored width wider than the viewport allows at the viewport maximum', () => {
      setViewportWidth(1000);
      renderContainer(900);

      // min(960, 1000 - 320) = 680; the stored value is not rewritten
      expect(getResizableArea().style.width).toBe('680px');
      expect(scheduleToPut).not.toHaveBeenCalled();
    });

    it('follows the viewport maximum when the window is resized', () => {
      renderContainer(900);
      expect(getResizableArea().style.width).toBe('900px');

      setViewportWidth(1000);
      act(() => {
        fireEvent(window, new Event('resize'));
      });

      expect(getResizableArea().style.width).toBe('680px');
    });
  });

  // Full width below sm comes from a media query, which happy-dom does not
  // evaluate; only the JS-driven part is asserted here.
  describe('on a viewport below the sm breakpoint', () => {
    it('renders without a resize handle', () => {
      deviceState.isLargerThanSm = false;
      renderContainer();

      expect(queryHandle()).toBeNull();
    });
  });

  // The breakpoint state starts as false until it resolves after mount
  it('renders the stored width on the first render, before the breakpoint is known', () => {
    deviceState.isLargerThanSm = false;
    renderContainer(640);

    expect(getResizableArea().style.width).toBe('640px');
  });

  it('follows the breakpoint when it changes', () => {
    const { rerender } = renderContainer();
    expect(queryHandle()).not.toBeNull();

    deviceState.isLargerThanSm = false;
    rerender(
      <ChatSidebarResizableContainer>
        <div>content</div>
      </ChatSidebarResizableContainer>,
    );
    expect(queryHandle()).toBeNull();

    deviceState.isLargerThanSm = true;
    rerender(
      <ChatSidebarResizableContainer>
        <div>content</div>
      </ChatSidebarResizableContainer>,
    );
    expect(queryHandle()).not.toBeNull();
    expect(getResizableArea().style.width).toBe('500px');
  });
});
