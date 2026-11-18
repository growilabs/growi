export type ResizableAnchor = 'left' | 'right';

type ComputeWidthInput = {
  readonly anchor: ResizableAnchor;
  /** Pointer x in viewport coordinates (MouseEvent.clientX) */
  readonly pointerX: number;
  readonly viewportWidth: number;
  readonly minWidth: number;
  /** No upper bound when omitted */
  readonly maxWidth?: number;
};

const rawWidthFromPointer = (
  anchor: ResizableAnchor,
  pointerX: number,
  viewportWidth: number,
): number => {
  return anchor === 'left' ? pointerX : viewportWidth - pointerX;
};

export const computeWidthFromPointer = (input: ComputeWidthInput): number => {
  const { anchor, pointerX, viewportWidth, minWidth, maxWidth } = input;
  const raw = rawWidthFromPointer(anchor, pointerX, viewportWidth);
  const capped = maxWidth == null ? raw : Math.min(raw, maxWidth);
  // minWidth wins over a smaller maxWidth so the result is never below minWidth
  return Math.max(capped, minWidth);
};

export const isCollapseGesture = (
  input: Omit<ComputeWidthInput, 'maxWidth'>,
): boolean => {
  const { anchor, pointerX, viewportWidth, minWidth } = input;
  return rawWidthFromPointer(anchor, pointerX, viewportWidth) < minWidth / 2;
};
