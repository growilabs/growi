/**
 * HTML attribute name applied to elements that are currently being rendered
 * (e.g. Drawio, Mermaid diagrams). Set to "true" while rendering is in progress,
 * toggled to "false" once rendering is complete.
 * Used by the auto-scroll system to detect in-progress renders before re-scrolling.
 */
export const GROWI_IS_CONTENT_RENDERING_ATTR =
  'data-growi-is-content-rendering' as const;

/**
 * CSS selector matching elements currently rendering (value="true" only).
 * Does not match completed elements (value="false").
 */
export const GROWI_IS_CONTENT_RENDERING_SELECTOR =
  `[${GROWI_IS_CONTENT_RENDERING_ATTR}="true"]` as const;

/**
 * HTML attribute marking a subtree rendered inside page content as interface
 * decoration rather than authored content (e.g. an attachment card's icon or
 * its uploader's avatar). Presence alone is the marker; any value is ignored.
 * Features that read the page body as content, such as inline-comment
 * anchoring, skip the whole subtree.
 */
export const GROWI_DECORATION_ATTR = 'data-growi-decoration' as const;
