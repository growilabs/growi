import { toInitials } from './widget';

export type OffScreenIndicatorOptions = {
  direction: 'above' | 'below';
  color: string;
  name: string;
  imageUrlCached: string | undefined;
  isActive: boolean;
};

/**
 * Creates an off-screen indicator DOM element for a remote cursor
 * that is outside the visible viewport.
 *
 * DOM structure (above):
 *   <span class="cm-offScreenIndicator">
 *     <span class="material-symbols-outlined cm-offScreenArrow">arrow_drop_up</span>
 *     <img class="cm-offScreenAvatar" />  or  <span class="cm-offScreenInitials" />
 *   </span>
 *
 * DOM structure (below):
 *   <span class="cm-offScreenIndicator">
 *     <img class="cm-offScreenAvatar" />  or  <span class="cm-offScreenInitials" />
 *     <span class="material-symbols-outlined cm-offScreenArrow">arrow_drop_down</span>
 *   </span>
 *
 * Horizontal position (left / transform) is set by the caller via requestMeasure.
 */
export function createOffScreenIndicator(
  opts: OffScreenIndicatorOptions,
): HTMLElement {
  const { direction, color, name, imageUrlCached, isActive } = opts;

  const indicator = document.createElement('span');
  indicator.className = 'cm-offScreenIndicator';
  indicator.style.borderColor = color;
  if (isActive) {
    indicator.classList.add('cm-yRichCursorActive');
  }

  const arrow = document.createElement('span');
  arrow.className = 'material-symbols-outlined cm-offScreenArrow';
  arrow.style.color = color;
  arrow.textContent =
    direction === 'above' ? 'arrow_drop_up' : 'arrow_drop_down';

  let avatarEl: HTMLElement;
  if (imageUrlCached) {
    const img = document.createElement('img');
    img.className = 'cm-offScreenAvatar';
    img.src = imageUrlCached;
    img.alt = name;
    img.style.borderColor = color;
    img.onerror = () => {
      const initials = document.createElement('span');
      initials.className = 'cm-offScreenInitials';
      initials.style.backgroundColor = color;
      initials.style.borderColor = color;
      initials.textContent = toInitials(name);
      img.replaceWith(initials);
    };
    avatarEl = img;
  } else {
    const initials = document.createElement('span');
    initials.className = 'cm-offScreenInitials';
    initials.style.backgroundColor = color;
    initials.style.borderColor = color;
    initials.textContent = toInitials(name);
    avatarEl = initials;
  }

  // "above": arrow points up (toward the off-screen cursor), avatar below
  // "below": avatar above, arrow points down (toward the off-screen cursor)
  if (direction === 'above') {
    indicator.appendChild(arrow);
    indicator.appendChild(avatarEl);
  } else {
    indicator.appendChild(avatarEl);
    indicator.appendChild(arrow);
  }

  return indicator;
}
