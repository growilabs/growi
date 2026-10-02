import React, { type JSX } from 'react';

type SortIconsProps = {
  onClick: (sortOrder: string) => void;
  isSelected: boolean;
  isAsc: boolean;
};

export const SortIcons = (props: SortIconsProps): JSX.Element => {
  const { onClick, isSelected, isAsc } = props;

  return (
    <div className="d-flex flex-column text-center">
      <button
        type="button"
        className={`${isSelected && isAsc ? 'text-primary' : 'text-muted'} btn btn-link p-0`}
        onClick={() => onClick('asc')}
        aria-pressed={isSelected && isAsc}
        aria-label="Sort ascending"
      >
        <span className="material-symbols-outlined">expand_less</span>
      </button>
      <button
        type="button"
        className={`${isSelected && !isAsc ? 'text-primary' : 'text-muted'} btn btn-link p-0`}
        onClick={() => onClick('desc')}
        aria-pressed={isSelected && !isAsc}
        aria-label="Sort descending"
      >
        <span className="material-symbols-outlined">expand_more</span>
      </button>
    </div>
  );
};
