import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hotkeyBindings, SwitchToMirrorMode } from './SwitchToMirrorMode';

afterEach(() => {
  cleanup();
  document.body.classList.remove('mirror');
});

describe('SwitchToMirrorMode', () => {
  describe('hotkeyBindings', () => {
    it('defines the Konami-style key sequence as modifier category', () => {
      expect(hotkeyBindings).toEqual({
        keys: 'x x b b a y a y ArrowDown ArrowLeft',
        category: 'modifier',
      });
    });
  });

  describe('behavior', () => {
    it('adds "mirror" class to document.body and calls onDeleteRender', () => {
      const onDeleteRender = vi.fn();

      expect(document.body.classList.contains('mirror')).toBe(false);

      render(<SwitchToMirrorMode onDeleteRender={onDeleteRender} />);

      expect(document.body.classList.contains('mirror')).toBe(true);
      expect(onDeleteRender).toHaveBeenCalledOnce();
    });
  });
});
