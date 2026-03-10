/**
 * HTML attribute name applied to elements that are currently being rendered
 * (e.g. Drawio, Mermaid diagrams). Removed once rendering is complete.
 * Used by PageView to detect in-progress renders before auto-scrolling.
 */
export const GROWI_RENDERING_ATTR = 'data-growi-rendering' as const;

/** CSS attribute selector for elements with {@link GROWI_RENDERING_ATTR}. */
export const GROWI_RENDERING_ATTR_SELECTOR =
  `[${GROWI_RENDERING_ATTR}]` as const;
