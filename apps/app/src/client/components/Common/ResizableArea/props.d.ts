import type { ResizableAnchor } from './compute-width';

export type ResizableAreaProps = {
  className?: string;
  width?: number;
  minWidth?: number;
  /** No upper bound when omitted */
  maxWidth?: number;
  /** Which viewport edge the area is attached to. Defaults to 'left'. */
  anchor?: ResizableAnchor;
  disabled?: boolean;
  children?: React.ReactNode;
  onResize?: (newWidth: number) => void;
  onResizeDone?: (newWidth: number) => void;
  /**
   * Called instead of onResizeDone when the pointer is released below half of
   * minWidth. When omitted, the width is clamped to minWidth instead.
   */
  onCollapsed?: () => void;
};
