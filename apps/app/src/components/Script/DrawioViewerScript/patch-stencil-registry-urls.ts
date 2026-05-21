// viewer-static.min.js hardcodes stencil resource URLs to https://viewer.diagrams.net.
// For local draw.io instances that origin is unreachable, so we rewrite the URLs
// in mxStencilRegistry.libraries (fetched lazily on first diagram render) to point
// to the configured local origin before any diagram is rendered.
// refs: https://github.com/growilabs/growi/issues/10726
export const VIEWER_DIAGRAMS_NET_ORIGIN = 'https://viewer.diagrams.net';

export const patchStencilRegistryUrls = (
  libraries: Record<string, string[]> | undefined,
  localOrigin: string,
): void => {
  if (libraries == null) return;
  for (const key of Object.keys(libraries)) {
    libraries[key] = libraries[key].map((url) =>
      typeof url === 'string'
        ? url.replace(VIEWER_DIAGRAMS_NET_ORIGIN, localOrigin)
        : url,
    );
  }
};
