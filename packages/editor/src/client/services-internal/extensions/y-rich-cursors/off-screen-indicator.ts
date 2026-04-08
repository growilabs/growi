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
  arrow.className = 'cm-offScreenArrow';
  arrow.textContent = direction === 'above' ? '↑' : '↓';
  indicator.appendChild(arrow);

  if (imageUrlCached) {
    const img = document.createElement('img');
    img.className = 'cm-offScreenAvatar';
    img.src = imageUrlCached;
    img.alt = name;
    img.onerror = () => {
      const initials = document.createElement('span');
      initials.className = 'cm-offScreenInitials';
      initials.style.backgroundColor = color;
      initials.textContent = toInitials(name);
      img.replaceWith(initials);
    };
    indicator.appendChild(img);
  } else {
    const initials = document.createElement('span');
    initials.className = 'cm-offScreenInitials';
    initials.style.backgroundColor = color;
    initials.textContent = toInitials(name);
    indicator.appendChild(initials);
  }

  return indicator;
}
