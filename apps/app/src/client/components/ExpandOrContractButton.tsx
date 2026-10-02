import type { FC } from 'react';
import React from 'react';

import styles from './ExpandOrContractButton.module.scss';

type Props = {
  isWindowExpanded: boolean;
  contractWindow?: () => void;
  expandWindow?: () => void;
};

const moduleClass = styles['btn-expand-or-contract'] ?? '';

const ExpandOrContractButton: FC<Props> = (props: Props) => {
  const { isWindowExpanded, contractWindow, expandWindow } = props;

  const clickContractButtonHandler = (): void => {
    if (contractWindow != null) {
      contractWindow();
    }
  };

  const clickExpandButtonHandler = (): void => {
    if (expandWindow != null) {
      expandWindow();
    }
  };

  return (
    <button
      type="button"
      className={`btn ${moduleClass}`}
      onClick={
        isWindowExpanded ? clickContractButtonHandler : clickExpandButtonHandler
      }
    >
      <span className="material-symbols-outlined fw-bold">
        {isWindowExpanded ? 'close_fullscreen' : 'open_in_full'}
      </span>
    </button>
  );
};

export default ExpandOrContractButton;
