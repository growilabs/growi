export interface IGraphViewer {
  checkVisibleState: boolean;
  responsive: boolean;
  lightboxZIndex: number;
  toolbarZIndex: number;
  xml: string;
}

export interface IGraphViewerGlobal {
  processElements: () => void;
  createViewerForElement: (
    element: Element,
    callback?: (viewer: IGraphViewer) => void,
  ) => void;

  useResizeSensor: boolean;
  prototype: IGraphViewer;
}
