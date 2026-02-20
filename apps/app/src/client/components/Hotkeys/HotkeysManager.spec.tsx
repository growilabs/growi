import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock all subscriber components as simple render trackers
vi.mock('./Subscribers/EditPage', () => ({ default: vi.fn(() => null) }));
vi.mock('./Subscribers/CreatePage', () => ({ default: vi.fn(() => null) }));
vi.mock('./Subscribers/FocusToGlobalSearch', () => ({
  default: vi.fn(() => null),
}));
vi.mock('./Subscribers/ShowShortcutsModal', () => ({
  default: vi.fn(() => null),
}));
vi.mock('./Subscribers/ShowStaffCredit', () => ({
  default: vi.fn(() => null),
}));
vi.mock('./Subscribers/SwitchToMirrorMode', () => ({
  default: vi.fn(() => null),
}));

const { default: HotkeysManager } = await import('./HotkeysManager');
const { default: EditPage } = await import('./Subscribers/EditPage');
const { default: CreatePage } = await import('./Subscribers/CreatePage');
const { default: FocusToGlobalSearch } = await import(
  './Subscribers/FocusToGlobalSearch'
);
const { default: ShowShortcutsModal } = await import(
  './Subscribers/ShowShortcutsModal'
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pressKey = (key: string, options: Partial<KeyboardEventInit> = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  // jsdom does not wire ctrlKey/metaKey to getModifierState — override for tinykeys
  Object.defineProperty(event, 'getModifierState', {
    value: (mod: string) => {
      if (mod === 'Control') return !!options.ctrlKey;
      if (mod === 'Meta') return !!options.metaKey;
      if (mod === 'Shift') return !!options.shiftKey;
      if (mod === 'Alt') return !!options.altKey;
      return false;
    },
  });
  window.dispatchEvent(event);
};

describe('HotkeysManager', () => {
  it('triggers EditPage on "e" key press', () => {
    render(<HotkeysManager />);
    act(() => {
      pressKey('e');
    });
    expect(EditPage).toHaveBeenCalled();
  });

  it('triggers CreatePage on "c" key press', () => {
    render(<HotkeysManager />);
    act(() => {
      pressKey('c');
    });
    expect(CreatePage).toHaveBeenCalled();
  });

  it('triggers FocusToGlobalSearch on "/" key press', () => {
    render(<HotkeysManager />);
    act(() => {
      pressKey('/');
    });
    expect(FocusToGlobalSearch).toHaveBeenCalled();
  });

  it('triggers ShowShortcutsModal on Ctrl+/ key press', () => {
    render(<HotkeysManager />);
    act(() => {
      pressKey('/', { ctrlKey: true });
    });
    expect(ShowShortcutsModal).toHaveBeenCalled();
  });

  it('does NOT trigger shortcut when target is an input element', () => {
    render(<HotkeysManager />);
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'e',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(EditPage).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('does NOT trigger shortcut when target is a textarea element', () => {
    render(<HotkeysManager />);
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'c',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(CreatePage).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });
});
