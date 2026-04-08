import { describe, expect, it } from 'vitest';

import { createOffScreenIndicator } from './off-screen-indicator';

/**
 * Unit tests for off-screen indicators.
 *
 * Covers:
 * - Task 9.2: Off-screen indicator DOM construction and avatar fallback
 * - Requirements: 4.1, 4.2, 4.4
 */

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
