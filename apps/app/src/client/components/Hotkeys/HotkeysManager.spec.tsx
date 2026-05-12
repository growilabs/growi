import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock all subscriber components as simple render trackers with their binding definitions
vi.mock('./Subscribers/EditPage', () => ({
  EditPage: vi.fn(() => null),
  hotkeyBindings: { keys: 'e', category: 'single' },
}));
vi.mock('./Subscribers/CreatePage', () => ({
  CreatePage: vi.fn(() => null),
  hotkeyBindings: { keys: 'c', category: 'single' },
}));
vi.mock('./Subscribers/FocusToGlobalSearch', () => ({
  FocusToGlobalSearch: vi.fn(() => null),
  hotkeyBindings: { keys: '/', category: 'single' },
}));
vi.mock('./Subscribers/ShowShortcutsModal', () => ({
  ShowShortcutsModal: vi.fn(() => null),
  hotkeyBindings: { keys: ['Control+/', 'Meta+/'], category: 'modifier' },
}));
vi.mock('./Subscribers/ShowStaffCredit', () => ({
  ShowStaffCredit: vi.fn(() => null),
  hotkeyBindings: {
    keys: 'ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a',
    category: 'modifier',
  },
}));
vi.mock('./Subscribers/SwitchToMirrorMode', () => ({
  SwitchToMirrorMode: vi.fn(() => null),
  hotkeyBindings: {
    keys: 'x x b b a y a y ArrowDown ArrowLeft',
    category: 'modifier',
  },
}));

const { default: HotkeysManager } = await import('./HotkeysManager');
const { EditPage } = await import('./Subscribers/EditPage');
const { ShowShortcutsModal } = await import('./Subscribers/ShowShortcutsModal');

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
  // happy-dom does not wire ctrlKey/metaKey to getModifierState — override for tinykeys
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
  it('renders the corresponding subscriber when a single key is pressed', () => {
    render(<HotkeysManager />);
    act(() => {
      pressKey('e');
    });
    expect(EditPage).toHaveBeenCalled();
  });

  it('renders the corresponding subscriber when a modifier key combo is pressed', () => {
    render(<HotkeysManager />);
    act(() => {
      pressKey('/', { ctrlKey: true });
    });
    expect(ShowShortcutsModal).toHaveBeenCalled();
  });

  it('does NOT trigger single-key shortcut when target is an editable element', () => {
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
});
