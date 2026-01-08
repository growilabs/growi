import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalHeader } from 'reactstrap';

import {
  AiAssistantManagementModalPageMode,
  useAiAssistantManagementModalActions,
} from '../../../states/modal/ai-assistant-management';

type Props = {
  labelTranslationKey: string;
  hideBackButton?: boolean;
  backButtonColor?: 'primary' | 'secondary';
  backToPageMode?: AiAssistantManagementModalPageMode;
};

export const AiAssistantManagementHeader = (props: Props): JSX.Element => {
  const {
    labelTranslationKey,
    hideBackButton,
    backButtonColor = 'primary',
    backToPageMode = AiAssistantManagementModalPageMode.HOME,
  } = props;

  const { t } = useTranslation();
  const { close, changePageMode } = useAiAssistantManagementModalActions();

  return (
    <ModalHeader
      tag="h4"
      close={
        <button type="button" className="btn p-0" onClick={close}>
          <span className="material-symbols-outlined">close</span>
        </button>
      }
    >
      <div className="d-flex align-items-center">
        {hideBackButton ? (
          <span className="growi-custom-icons growi-ai-assistant-icon me-3 fs-4">
            growi_ai
          </span>
        ) : (
          <button
            type="button"
            className="btn p-0 me-3"
            onClick={() => changePageMode(backToPageMode)}
          >
            <span
              className={`material-symbols-outlined text-${backButtonColor}`}
            >
              chevron_left
            </span>
          </button>
        )}
        <span className="fw-bold">{t(labelTranslationKey)}</span>
      </div>
    </ModalHeader>
  );
};
