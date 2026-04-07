import { describe, expect, it } from 'vitest';

import { RichCaretWidget } from './y-rich-cursors';

/**
 * Unit tests for RichCaretWidget.
 *
 * Covers:
 * - Task 2.1 / 4.2: DOM construction with image and initials fallback
 * - Requirements: 3.1, 3.2, 3.3, 3.4
 */

describe('RichCaretWidget', () => {
  describe('toDOM()', () => {
    it('renders a cm-yRichCaret span with border color from the color parameter', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined);
      const dom = widget.toDOM();

      expect(dom.className).toBe('cm-yRichCaret');
      expect(dom.style.borderColor).toBe('#ff0000');
    });

    it('renders a name label with the display name', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined);
      const dom = widget.toDOM();

      const info = dom.querySelector('.cm-yRichCursorInfo');
      expect(info).not.toBeNull();
      expect(info?.textContent).toBe('Alice');
    });

    it('renders an img element when imageUrlCached is provided', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');
      const dom = widget.toDOM();

      const img = dom.querySelector(
        'img.cm-yRichCursorAvatar',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img?.src).toContain('/avatar.png');
      expect(img?.alt).toBe('Alice');
    });

    it('does NOT render an img element when imageUrlCached is undefined', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined);
      const dom = widget.toDOM();

      const img = dom.querySelector('img.cm-yRichCursorAvatar');
      expect(img).toBeNull();
    });

    it('renders initials span when imageUrlCached is undefined', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice Bob', undefined);
      const dom = widget.toDOM();

      const initials = dom.querySelector('.cm-yRichCursorInitials');
      expect(initials).not.toBeNull();
      // initials are first letters of each word, uppercased
      expect(initials?.textContent).toBe('AB');
    });

    it('renders initials for a single-word name', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined);
      const dom = widget.toDOM();

      const initials = dom.querySelector('.cm-yRichCursorInitials');
      expect(initials?.textContent).toBe('A');
    });

    it('replaces img with initials span on onerror', () => {
      const widget = new RichCaretWidget('#0000ff', 'Bob', '/broken.png');
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
  });

  describe('eq()', () => {
    it('returns true when color, name, and imageUrlCached all match', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');
      const b = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');

      expect(a.eq(b)).toBe(true);
    });

    it('returns false when color differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');
      const b = new RichCaretWidget('#0000ff', 'Alice', '/avatar.png');

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when name differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');
      const b = new RichCaretWidget('#ff0000', 'Bob', '/avatar.png');

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when imageUrlCached differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');
      const b = new RichCaretWidget('#ff0000', 'Alice', '/other.png');

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when one has imageUrlCached and the other does not', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png');
      const b = new RichCaretWidget('#ff0000', 'Alice', undefined);

      expect(a.eq(b)).toBe(false);
    });
  });

  describe('ignoreEvent()', () => {
    it('returns true', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined);
      expect(widget.ignoreEvent()).toBe(true);
    });
  });

  describe('estimatedHeight', () => {
    it('is -1 (inline widget)', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined);
      expect(widget.estimatedHeight).toBe(-1);
    });
  });
});
