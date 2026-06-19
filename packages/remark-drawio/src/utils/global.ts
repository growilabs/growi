import type { IGraphViewerGlobal } from '../interfaces/graph-viewer.js';

export const isGraphViewerGlobal = (
  val: unknown,
): val is IGraphViewerGlobal => {
  return (
    typeof val === 'function' &&
    'createViewerForElement' in val &&
    'processElements' in val
  );
};
