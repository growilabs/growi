/**
 * The highlight states an image inside a commented range can be in, ordered
 * from LOWEST to HIGHEST priority. When an image is in several states at once
 * (e.g. a saved comment that is also being emphasized), only the
 * highest-priority state's outline is drawn, matching how the text highlights
 * stack.
 */
export const IMAGE_HIGHLIGHT_STATES = ['saved', 'pending', 'emphasis'] as const;

export type ImageHighlightState = (typeof IMAGE_HIGHLIGHT_STATES)[number];

/**
 * Space-separated list of the states an image is currently in, e.g.
 * `data-inline-comment-image="saved emphasis"`. One attribute shared by all
 * states, so that each state can be added and removed independently.
 */
const ATTRIBUTE = 'data-inline-comment-image';

/**
 * Adds `state` to every image's marker attribute and returns a function that
 * removes it again. Only an attribute is touched — no element is added, moved
 * or removed — so the React-owned page body keeps the same DOM structure.
 */
export const markImages = (
  images: Iterable<HTMLImageElement>,
  state: ImageHighlightState,
): (() => void) => {
  const marked = Array.from(new Set(images));
  for (const image of marked) {
    const current = statesOf(image);
    if (!current.includes(state)) {
      image.setAttribute(ATTRIBUTE, [...current, state].join(' '));
    }
  }

  return () => {
    for (const image of marked) {
      const remaining = statesOf(image).filter((s) => s !== state);
      if (remaining.length === 0) {
        image.removeAttribute(ATTRIBUTE);
      } else {
        image.setAttribute(ATTRIBUTE, remaining.join(' '));
      }
    }
  };
};

/**
 * CSS selector matching an image whose highest-priority state is `state`.
 * Each highlight component styles its own state with this selector, and the
 * priority order lives only in `IMAGE_HIGHLIGHT_STATES`, so the result never
 * depends on which component's `<style>` tag happens to load last.
 */
export const imageOutlineSelector = (state: ImageHighlightState): string => {
  const higher = IMAGE_HIGHLIGHT_STATES.slice(
    IMAGE_HIGHLIGHT_STATES.indexOf(state) + 1,
  );
  const exclusions = higher.map((h) => `:not([${ATTRIBUTE}~="${h}"])`).join('');
  return `img[${ATTRIBUTE}~="${state}"]${exclusions}`;
};

const statesOf = (image: HTMLImageElement): string[] =>
  (image.getAttribute(ATTRIBUTE) ?? '').split(' ').filter((s) => s !== '');
