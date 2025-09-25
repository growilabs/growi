import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

type Props = {
  isRebuildingProcessing: boolean,
  onNormalizingRequested: () => void,
  isNormalized?: boolean,
}

const NormalizeIndicesControls = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');
  const { isNormalized, isRebuildingProcessing } = props;

  const isEnabled = (isNormalized != null) && !isNormalized && !isRebuildingProcessing;

  return (
    <>
      <button
        type="submit"
        className={`btn ${isEnabled ? 'btn-outline-info' : 'btn-outline-secondary'}`}
        onClick={() => { props.onNormalizingRequested() }}
        disabled={!isEnabled}
      >
        { t('full_text_search_management.normalize_button') }
      </button>

      <p className="form-text text-muted">
        { t('full_text_search_management.normalize_description') }<br />
      </p>
    </>
  );
};

export default NormalizeIndicesControls;
