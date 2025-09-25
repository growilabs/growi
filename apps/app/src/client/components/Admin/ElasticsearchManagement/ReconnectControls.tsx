import React, { type JSX } from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';


type Props = {
  isEnabled?: boolean,
  isProcessing?: boolean,
  onReconnectingRequested: () => void,
}

const ReconnectControls = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  const { isEnabled, isProcessing } = props;

  return (
    <>
      <button
        type="submit"
        className={`btn ${isEnabled ? 'btn-outline-success' : 'btn-outline-secondary'}`}
        onClick={() => { props.onReconnectingRequested() }}
        disabled={!isEnabled}
      >
        { isProcessing && <LoadingSpinner className="me-2" /> }
        { t('full_text_search_management.reconnect_button') }
      </button>

      <p className="form-text text-muted">
        { t('full_text_search_management.reconnect_description') }<br />
      </p>
    </>
  );

};

export default ReconnectControls;
