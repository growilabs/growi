export interface ISelectable {
  select: () => void;
  deselect: () => void;
}

export interface ISelectableAndIndeterminatable extends ISelectable {
  setIndeterminate: () => void;
}

export interface ISelectableAll {
  selectAll: () => void;
  deselectAll: () => void;
}
