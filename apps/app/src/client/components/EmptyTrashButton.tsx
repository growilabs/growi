import React, { useCallback, type JSX } from 'react';

import { useTranslation } from 'next-i18next';

type EmptyTrashButtonProps = {
  onEmptyTrashButtonClick: () => void,
  disableEmptyButton: boolean
};


const EmptyTrashButton = (props: EmptyTrashButtonProps): JSX.Element => {
  const { onEmptyTrashButtonClick, disableEmptyButton } = props;
  const { t } = useTranslation();

  const emptyTrashButtonHandler = useCallback(() => {
    onEmptyTrashButtonClick();
  }, [onEmptyTrashButtonClick]);

  return (
    <div className="d-flex align-items-center">
      <button
        type="button"
        className="btn btn-outline-secondary rounded-pill text-danger d-flex align-items-center"
        disabled={disableEmptyButton}
        onClick={emptyTrashButtonHandler}
      >
        <span className="material-symbols-outlined">delete</span>
        <div>{t('modal_empty.empty_the_trash')}</div>
      </button>
    </div>
  );
};

export default EmptyTrashButton;
