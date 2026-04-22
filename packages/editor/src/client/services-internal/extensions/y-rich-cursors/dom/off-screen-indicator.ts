import { toInitials } from './widget';

export type OffScreenIndicatorOptions = {
  direction: 'above' | 'below';
  /** Client ID of the remote user; passed to onClick when the indicator is clicked. */
  clientId: number;
  color: string;
  name: string;
  imageUrlCached: string | undefined;
  isActive: boolean;
  /** Invoked with clientId when the indicator is clicked. Omit to suppress click handling. */
  onClick?: (clientId: number) => void;
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
  const {
    direction,
    clientId,
    color,
    name,
    imageUrlCached,
    isActive,
    onClick,
  } = opts;

  const indicator = document.createElement('span');
  indicator.className = 'cm-offScreenIndicator';
  indicator.style.borderColor = color;
  if (isActive) {
    indicator.classList.add('cm-yRichCursorActive');
  }

  if (onClick != null) {
    indicator.style.cursor = 'pointer';
    indicator.addEventListener('click', () => onClick(clientId));
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

  const tooltip = document.createElement('span');
  tooltip.className = 'cm-offScreenTooltip';
  tooltip.style.backgroundColor = color;
  tooltip.textContent = name;

  // "above": arrow points up (toward the off-screen cursor), avatar below
  // "below": avatar above, arrow points down (toward the off-screen cursor)
  if (direction === 'above') {
    indicator.appendChild(arrow);
    indicator.appendChild(avatarEl);
    tooltip.style.bottom = '0';
  } else {
    indicator.appendChild(avatarEl);
    indicator.appendChild(arrow);
    tooltip.style.top = '0';
  }
  indicator.appendChild(tooltip);

  return indicator;
}
