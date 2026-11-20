/**
 * The draw.io / mxGraph globals this module writes to.
 *
 * Every one of them is initialised by viewer-static.min.js as
 * `window.X = window.X || <value baked into the bundle>`, which is the whole reason this
 * module can work by assignment alone: a value written before the bundle evaluates
 * survives, and nothing has to be un-done afterwards.
 */

/**
 * The part of MathJax's configuration draw.io fills in. Once MathJax boots it replaces
 * this global with its own API object, so a value read after that point is not this shape.
 */
export type MathJaxConfig = {
  loader?: { paths?: Record<string, string> };
};

declare global {
  // Asset locations. Reached with XMLHttpRequest, so they have to be same-origin.
  var STENCIL_PATH: string | undefined;
  var SHAPES_PATH: string | undefined;
  var STYLE_PATH: string | undefined;

  // Asset locations reached as <img>, which cross-origin loads are fine for.
  var GRAPH_IMAGE_PATH: string | undefined;
  var mxBasePath: string | undefined;
  var mxImageBasePath: string | undefined;

  // Where the lightbox's "edit" affordance sends the reader.
  var DRAWIO_LIGHTBOX_URL: string | undefined;

  // MathJax's location, and the configuration draw.io builds around it.
  var DRAW_MATH_URL: string | undefined;
  var MathJax: MathJaxConfig | undefined;

  /**
   * draw.io's editor namespace. Only `initMath` is used here: it is the function that
   * decides where MathJax is loaded from, and it is re-run so that decision can be made
   * again with the corrected location.
   */
  var Editor:
    | {
        initMath?: (startupUrl?: string, config?: MathJaxConfig) => void;
      }
    | undefined;
}
