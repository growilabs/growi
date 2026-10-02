import { animate } from 'motion';

type ScrollToElementOptions = {
  offset?: number;
  duration?: number;
};

/**
 * Smooth scroll to an element by ID
 */
export const scrollToElement = (
  id: string,
  { offset = 0, duration = 0.5 }: ScrollToElementOptions = {},
): void => {
  const el = document.getElementById(id);
  if (el == null) return;
  const target = el.getBoundingClientRect().top + window.scrollY + offset;
  animate(window.scrollY, target, {
    duration,
    onUpdate: (v) => window.scrollTo(0, v),
  });
};

/**
 * Smooth scroll within a container by a relative distance
 */
export const scrollWithinContainer = (
  container: HTMLElement,
  distance: number,
  duration = 0.2,
): void => {
  animate(container.scrollTop, container.scrollTop + distance, {
    duration,
    onUpdate: (v) => {
      container.scrollTop = v;
    },
  });
};
