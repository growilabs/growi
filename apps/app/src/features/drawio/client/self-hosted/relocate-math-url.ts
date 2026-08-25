import urljoin from 'url-join';

// viewer-static.min.js bakes an absolute MathJax location into window.DRAW_MATH_URL
// (https://viewer.diagrams.net/math/es5 up to draw.io v28, .../math4/es5 from v29). A
// self-hosted instance ships those assets itself, so the location has to be moved back
// onto the configured instance or math never renders.
// The baked path always matches the layout the instance ships, so reusing it removes any
// need to detect the draw.io version.
// refs: https://github.com/growilabs/growi/issues/9774
export const relocateMathUrl = (
  bakedMathUrl: string | undefined,
  drawioUri: string,
): string | undefined => {
  if (bakedMathUrl == null) {
    return undefined;
  }

  try {
    const baked = new URL(bakedMathUrl);
    const drawio = new URL(drawioUri);
    return `${drawio.origin}${urljoin(drawio.pathname, baked.pathname)}`;
  } catch {
    return undefined;
  }
};
