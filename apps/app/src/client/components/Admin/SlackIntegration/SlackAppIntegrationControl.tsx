
import type { JSX } from 'react';

import { useTranslation } from 'next-i18next';


type Props = {
  slackAppIntegration: {
    _id: string,
    isPrimary?: boolean,
  },
  onIsPrimaryChanged?: (slackAppIntegration: unknown, newValue: boolean) => void,
  onDeleteButtonClicked?: (slackAppIntegration: unknown) => void,
}

export const SlackAppIntegrationControl = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const { slackAppIntegration, onIsPrimaryChanged, onDeleteButtonClicked } = props;
  const inputId = `cb-primary-${slackAppIntegration._id}`;
  const isPrimary = slackAppIntegration.isPrimary === true;

  return (
    <div className="d-flex align-items-center">
      <div className="my-1 form-check form-switch">
        <input
          className="form-check-input"
          id={inputId}
          type="checkbox"
          checked={isPrimary}
          disabled={isPrimary}
          onChange={(e) => {
            if (onIsPrimaryChanged != null) {
              onIsPrimaryChanged(slackAppIntegration, e.target.checked);
            }
          }}
        />
        <label className="form-label form-check-label" htmlFor={inputId}>
          Primary
        </label>
      </div>
      <button
        className="btn btn-outline-danger ms-3"
        type="button"
        onClick={() => {
          if (onDeleteButtonClicked != null) {
            onDeleteButtonClicked(slackAppIntegration);
          }
        }}
      >
        <span className="material-symbols-outlined">delete</span>
        {t('admin:slack_integration.delete')}
      </button>
    </div>
  );
};
