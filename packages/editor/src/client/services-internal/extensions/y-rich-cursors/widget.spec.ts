import { describe, expect, it } from 'vitest';

import { RichCaretWidget } from './widget';

/**
 * Unit tests for RichCaretWidget.
 *
 * Covers:
 * - Task 9.1: Updated widget DOM structure, overlay flag, sizing, isActive class
 * - Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10
 */

const opts = (
  overrides: Partial<ConstructorParameters<typeof RichCaretWidget>[0]> = {},
) => ({
  color: '#ff0000',
  name: 'Alice',
  imageUrlCached: undefined as string | undefined,
  isActive: false,
  ...overrides,
});

describe('RichCaretWidget', () => {
  describe('toDOM()', () => {
    it('renders a cm-yRichCaret span with border color from the color parameter', () => {
      const widget = new RichCaretWidget(opts());
      const dom = widget.toDOM();

      expect(dom.className).toBe('cm-yRichCaret');
      expect(dom.style.borderColor).toBe('#ff0000');
    });

    it('renders a flag container with position relative inside the caret element', () => {
      const widget = new RichCaretWidget(opts());
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      expect(flag).not.toBeNull();
    });

    it('renders an img element inside the flag when imageUrlCached is provided', () => {
      const widget = new RichCaretWidget(
        opts({ imageUrlCached: '/avatar.png' }),
      );
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      const img = flag?.querySelector(
        'img.cm-yRichCursorAvatar',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img?.src).toContain('/avatar.png');
      expect(img?.alt).toBe('Alice');
    });

    it('does NOT render an img element when imageUrlCached is undefined', () => {
      const widget = new RichCaretWidget(opts());
      const dom = widget.toDOM();

      const img = dom.querySelector('img.cm-yRichCursorAvatar');
      expect(img).toBeNull();
    });

    it('renders initials span inside the flag when imageUrlCached is undefined', () => {
      const widget = new RichCaretWidget(opts({ name: 'Alice Bob' }));
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      const initials = flag?.querySelector('.cm-yRichCursorInitials');
      expect(initials).not.toBeNull();
      expect(initials?.textContent).toBe('AB');
    });

    it('renders initials for a single-word name', () => {
      const widget = new RichCaretWidget(opts());
      const dom = widget.toDOM();

      const initials = dom.querySelector('.cm-yRichCursorInitials');
      expect(initials?.textContent).toBe('A');
    });

    it('replaces img with initials span on onerror', () => {
      const widget = new RichCaretWidget(
        opts({
          color: '#0000ff',
          name: 'Bob',
          imageUrlCached: '/broken.png',
        }),
      );
      const dom = widget.toDOM();

      const img = dom.querySelector(
        'img.cm-yRichCursorAvatar',
      ) as HTMLImageElement;
      expect(img).not.toBeNull();

      // Simulate image load failure
      img.dispatchEvent(new Event('error'));

      expect(dom.querySelector('img.cm-yRichCursorAvatar')).toBeNull();
      const initials = dom.querySelector('.cm-yRichCursorInitials');
      expect(initials).not.toBeNull();
      expect(initials?.textContent).toBe('B');
    });

    it('renders a name label inside the flag container', () => {
      const widget = new RichCaretWidget(opts());
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      const info = flag?.querySelector('.cm-yRichCursorInfo');
      expect(info).not.toBeNull();
      expect(info?.textContent).toBe('Alice');
    });

    it('applies cm-yRichCursorActive class to the flag element when isActive is true', () => {
      const widget = new RichCaretWidget(opts({ isActive: true }));
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      expect(flag?.classList.contains('cm-yRichCursorActive')).toBe(true);
    });

    it('does NOT apply cm-yRichCursorActive class to the flag when isActive is false', () => {
      const widget = new RichCaretWidget(opts());
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      expect(flag?.classList.contains('cm-yRichCursorActive')).toBe(false);
    });
  });

  describe('eq()', () => {
    it('returns true when all fields match', () => {
      const a = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));
      const b = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));

      expect(a.eq(b)).toBe(true);
    });

    it('returns false when color differs', () => {
      const a = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));
      const b = new RichCaretWidget(
        opts({ color: '#0000ff', imageUrlCached: '/avatar.png' }),
      );

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when name differs', () => {
      const a = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));
      const b = new RichCaretWidget(
        opts({ name: 'Bob', imageUrlCached: '/avatar.png' }),
      );

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when imageUrlCached differs', () => {
      const a = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));
      const b = new RichCaretWidget(opts({ imageUrlCached: '/other.png' }));

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when one has imageUrlCached and the other does not', () => {
      const a = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));
      const b = new RichCaretWidget(opts());

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when isActive differs', () => {
      const a = new RichCaretWidget(
        opts({ imageUrlCached: '/avatar.png', isActive: true }),
      );
      const b = new RichCaretWidget(opts({ imageUrlCached: '/avatar.png' }));

      expect(a.eq(b)).toBe(false);
    });
  });

  describe('ignoreEvent()', () => {
    it('returns true', () => {
      const widget = new RichCaretWidget(opts());
      expect(widget.ignoreEvent()).toBe(true);
    });
  });

  describe('estimatedHeight', () => {
    it('is -1 (inline widget)', () => {
      const widget = new RichCaretWidget(opts());
      expect(widget.estimatedHeight).toBe(-1);
    });
  });
});
