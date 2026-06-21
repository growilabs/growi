import type { IGraphViewerGlobal } from '../interfaces/graph-viewer';

export const isGraphViewerGlobal = (
  val: unknown,
): val is IGraphViewerGlobal => {
  return (
    typeof val === 'function' &&
    'createViewerForElement' in val &&
    'processElements' in val
  );
};
