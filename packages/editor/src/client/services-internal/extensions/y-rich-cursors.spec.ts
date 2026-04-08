import { describe, expect, it } from 'vitest';

import { createOffScreenIndicator, RichCaretWidget } from './y-rich-cursors';

/**
 * Unit tests for RichCaretWidget and off-screen indicators.
 *
 * Covers:
 * - Task 9.1: Updated widget DOM structure, overlay flag, sizing, isActive class
 * - Task 9.2: Off-screen indicator DOM construction and avatar fallback
 * - Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.10, 4.1, 4.2, 4.4
 */

describe('RichCaretWidget', () => {
  describe('toDOM()', () => {
    it('renders a cm-yRichCaret span with border color from the color parameter', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      const dom = widget.toDOM();

      expect(dom.className).toBe('cm-yRichCaret');
      expect(dom.style.borderColor).toBe('#ff0000');
    });

    it('renders a flag container with position relative inside the caret element', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      expect(flag).not.toBeNull();
    });

    it('renders an img element inside the flag when imageUrlCached is provided', () => {
      const widget = new RichCaretWidget(
        '#ff0000',
        'Alice',
        '/avatar.png',
        false,
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
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      const dom = widget.toDOM();

      const img = dom.querySelector('img.cm-yRichCursorAvatar');
      expect(img).toBeNull();
    });

    it('renders initials span inside the flag when imageUrlCached is undefined', () => {
      const widget = new RichCaretWidget(
        '#ff0000',
        'Alice Bob',
        undefined,
        false,
      );
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      const initials = flag?.querySelector('.cm-yRichCursorInitials');
      expect(initials).not.toBeNull();
      expect(initials?.textContent).toBe('AB');
    });

    it('renders initials for a single-word name', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      const dom = widget.toDOM();

      const initials = dom.querySelector('.cm-yRichCursorInitials');
      expect(initials?.textContent).toBe('A');
    });

    it('replaces img with initials span on onerror', () => {
      const widget = new RichCaretWidget(
        '#0000ff',
        'Bob',
        '/broken.png',
        false,
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
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      const info = flag?.querySelector('.cm-yRichCursorInfo');
      expect(info).not.toBeNull();
      expect(info?.textContent).toBe('Alice');
    });

    it('applies cm-yRichCursorActive class to the flag element when isActive is true', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, true);
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      expect(flag?.classList.contains('cm-yRichCursorActive')).toBe(true);
    });

    it('does NOT apply cm-yRichCursorActive class to the flag when isActive is false', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      const dom = widget.toDOM();

      const flag = dom.querySelector('.cm-yRichCursorFlag');
      expect(flag?.classList.contains('cm-yRichCursorActive')).toBe(false);
    });
  });

  describe('eq()', () => {
    it('returns true when color, name, imageUrlCached, and isActive all match', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);
      const b = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);

      expect(a.eq(b)).toBe(true);
    });

    it('returns false when color differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);
      const b = new RichCaretWidget('#0000ff', 'Alice', '/avatar.png', false);

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when name differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);
      const b = new RichCaretWidget('#ff0000', 'Bob', '/avatar.png', false);

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when imageUrlCached differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);
      const b = new RichCaretWidget('#ff0000', 'Alice', '/other.png', false);

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when one has imageUrlCached and the other does not', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);
      const b = new RichCaretWidget('#ff0000', 'Alice', undefined, false);

      expect(a.eq(b)).toBe(false);
    });

    it('returns false when isActive differs', () => {
      const a = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', true);
      const b = new RichCaretWidget('#ff0000', 'Alice', '/avatar.png', false);

      expect(a.eq(b)).toBe(false);
    });
  });

  describe('ignoreEvent()', () => {
    it('returns true', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      expect(widget.ignoreEvent()).toBe(true);
    });
  });

  describe('estimatedHeight', () => {
    it('is -1 (inline widget)', () => {
      const widget = new RichCaretWidget('#ff0000', 'Alice', undefined, false);
      expect(widget.estimatedHeight).toBe(-1);
    });
  });
});

describe('createOffScreenIndicator', () => {
  it('renders an indicator with an upward arrow for direction "above"', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    const arrow = el.querySelector('.cm-offScreenArrow');
    expect(arrow).not.toBeNull();
    expect(arrow?.textContent).toBe('↑');
  });

  it('renders an indicator with a downward arrow for direction "below"', () => {
    const el = createOffScreenIndicator({
      direction: 'below',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    const arrow = el.querySelector('.cm-offScreenArrow');
    expect(arrow?.textContent).toBe('↓');
  });

  it('renders an avatar image when imageUrlCached is provided', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    const img = el.querySelector(
      'img.cm-offScreenAvatar',
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toContain('/avatar.png');
  });

  it('renders initials fallback when imageUrlCached is undefined', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });

    const img = el.querySelector('img.cm-offScreenAvatar');
    expect(img).toBeNull();

    const initials = el.querySelector('.cm-offScreenInitials');
    expect(initials).not.toBeNull();
    expect(initials?.textContent).toBe('A');
  });

  it('applies cm-yRichCursorActive class when isActive is true', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: true,
    });

    expect(el.classList.contains('cm-yRichCursorActive')).toBe(true);
  });

  it('does NOT apply cm-yRichCursorActive class when isActive is false', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    expect(el.classList.contains('cm-yRichCursorActive')).toBe(false);
  });

  it('applies border-color from the color parameter', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });

    expect(el.style.borderColor).toBe('#ff0000');
  });
});
