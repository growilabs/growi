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
  it('renders an indicator with an upward Material Symbol for direction "above"', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    const arrow = el.querySelector('.cm-offScreenArrow');
    expect(arrow).not.toBeNull();
    expect(arrow?.textContent).toBe('arrow_drop_up');
    expect(arrow?.classList.contains('material-symbols-outlined')).toBe(true);
  });

  it('renders an indicator with a downward Material Symbol for direction "below"', () => {
    const el = createOffScreenIndicator({
      direction: 'below',
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    const arrow = el.querySelector('.cm-offScreenArrow');
    expect(arrow?.textContent).toBe('arrow_drop_down');
    expect(arrow?.classList.contains('material-symbols-outlined')).toBe(true);
  });

  it('places the arrow before the avatar for direction "above"', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });
    const children = Array.from(el.children);
    expect(children[0]?.classList.contains('cm-offScreenArrow')).toBe(true);
    expect(children[1]?.classList.contains('cm-offScreenInitials')).toBe(true);
  });

  it('places the avatar before the arrow for direction "below"', () => {
    const el = createOffScreenIndicator({
      direction: 'below',
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });
    const children = Array.from(el.children);
    expect(children[0]?.classList.contains('cm-offScreenInitials')).toBe(true);
    expect(children[1]?.classList.contains('cm-offScreenArrow')).toBe(true);
  });

  it('renders an avatar image when imageUrlCached is provided', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 1,
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
      clientId: 1,
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
      clientId: 1,
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
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    expect(el.classList.contains('cm-yRichCursorActive')).toBe(false);
  });

  it('applies border-color on the indicator wrapper from the color parameter', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });

    expect(el.style.borderColor).toBe('#ff0000');
  });

  it('sets borderColor on the avatar img to the cursor color', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 1,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: '/avatar.png',
      isActive: false,
    });

    const img = el.querySelector(
      'img.cm-offScreenAvatar',
    ) as HTMLImageElement | null;
    expect(img?.style.borderColor).toBe('#ff0000');
  });

  it('sets borderColor on the initials element to the cursor color', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 1,
      color: '#0000ff',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });

    const initials = el.querySelector(
      '.cm-offScreenInitials',
    ) as HTMLElement | null;
    expect(initials?.style.borderColor).toBe('#0000ff');
  });

  it('sets borderColor on the onerror-fallback initials to the cursor color', () => {
    const el = createOffScreenIndicator({
      direction: 'below',
      clientId: 1,
      color: '#00ff00',
      name: 'Alice',
      imageUrlCached: '/broken.png',
      isActive: false,
    });

    const img = el.querySelector('img.cm-offScreenAvatar') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));

    const initials = el.querySelector(
      '.cm-offScreenInitials',
    ) as HTMLElement | null;
    expect(initials?.style.borderColor).toBe('#00ff00');
  });
});

/**
 * Task 20.1 — Click behavior tests for off-screen indicators
 * Requirements: 6.6, 6.7
 */
describe('createOffScreenIndicator — click behavior (Task 20.1)', () => {
  it('applies cursor: pointer on the indicator root when onClick is provided', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 42,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
      onClick: vi.fn(),
    });

    expect(el.style.cursor).toBe('pointer');
  });

  it('does NOT apply cursor: pointer when onClick is not provided', () => {
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 42,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
    });

    expect(el.style.cursor).toBe('');
  });

  it('calls onClick with the correct clientId when indicator is clicked', () => {
    const onClick = vi.fn();
    const el = createOffScreenIndicator({
      direction: 'above',
      clientId: 42,
      color: '#ff0000',
      name: 'Alice',
      imageUrlCached: undefined,
      isActive: false,
      onClick,
    });

    el.dispatchEvent(new Event('click'));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledWith(42);
  });

  it('does not throw when clicked and onClick is not provided', () => {
    const el = createOffScreenIndicator({
      direction: 'below',
      clientId: 99,
      color: '#00ff00',
      name: 'Bob',
      imageUrlCached: undefined,
      isActive: false,
    });

    expect(() => el.dispatchEvent(new Event('click'))).not.toThrow();
  });

  it('works with clientId 0 (boundary value)', () => {
    const onClick = vi.fn();
    const el = createOffScreenIndicator({
      direction: 'below',
      clientId: 0,
      color: '#0000ff',
      name: 'Zero',
      imageUrlCached: undefined,
      isActive: false,
      onClick,
    });

    el.dispatchEvent(new Event('click'));
    expect(onClick).toHaveBeenCalledWith(0);
  });
});
