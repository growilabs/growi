import React from 'react';

import { useTranslation } from 'react-i18next';
import {
  ModalBody,
} from 'reactstrap';

import { useAiAssistantManagementModalStatus } from '../../../states/modal/ai-assistant-management';

import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { PageSelectionMethodButtons } from './PageSelectionMethodButtons';

export const AiAssistantManagementPageSelectionMethod = (): JSX.Element => {
  const { t } = useTranslation();
  const aiAssistantManagementModalData = useAiAssistantManagementModalStatus();
  const isNewAiAssistant = aiAssistantManagementModalData?.aiAssistantData == null;

  return (
    <>
      <AiAssistantManagementHeader
        hideBackButton={isNewAiAssistant}
        labelTranslationKey={isNewAiAssistant ? 'modal_ai_assistant.header.add_new_assistant' : 'modal_ai_assistant.header.update_assistant'}
      />

      <ModalBody className="px-4">
        <h4 className="text-center fw-bold mb-4 mt-2">
          {t('modal_ai_assistant.select_source_pages')}
        </h4>

        <PageSelectionMethodButtons />

      </ModalBody>
    </>
  );
};
