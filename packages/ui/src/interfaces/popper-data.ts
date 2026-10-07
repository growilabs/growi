interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PopperData {
  styles: Partial<CSSStyleDeclaration>;
  offsets: {
    popper: Rect;
    reference: Rect;
    arrow: { top: number; left: number };
  };
}
