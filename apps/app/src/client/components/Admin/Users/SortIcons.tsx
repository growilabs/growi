import React, { type JSX } from 'react';

type SortIconsProps = {
  onClick: (sortOrder: string) => void,
  isSelected: boolean,
  isAsc: boolean,
}

export const SortIcons = (props: SortIconsProps): JSX.Element => {

  const { onClick, isSelected, isAsc } = props;

  return (
    <div className="d-flex flex-column text-center">
      <a
        className={`${isSelected && isAsc ? 'text-primary' : 'text-muted'}`}
        aria-hidden="true"
        onClick={() => onClick('asc')}
      >
        <span className="material-symbols-outlined">expand_less</span>
      </a>
      <a
        className={`${isSelected && !isAsc ? 'text-primary' : 'text-muted'}`}
        aria-hidden="true"
        onClick={() => onClick('desc')}
      >
        <span className="material-symbols-outlined">expand_more</span>
      </a>
    </div>
  );
};
