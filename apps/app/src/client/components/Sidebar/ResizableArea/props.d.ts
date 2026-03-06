export type ResizableAreaProps = {
  className?: string;
  width?: number;
  minWidth?: number;
  disabled?: boolean;
  children?: React.ReactNode;
  onResize?: (newWidth: number) => void;
  onResizeDone?: (newWidth: number) => void;
  onCollapsed?: () => void;
};
