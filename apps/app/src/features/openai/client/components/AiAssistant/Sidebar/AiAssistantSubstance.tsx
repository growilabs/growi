import React, { type JSX, useCallback } from 'react';

import { useTranslation } from 'react-i18next';

import { useAiAssistantManagementModal, useSWRxAiAssistants, useAiAssistantSidebar } from '../../../stores/ai-assistant';
import { useSWRINFxRecentThreads } from '../../../stores/thread';

import { AiAssistantList } from './AiAssistantList';
import { ThreadList } from './ThreadList';

import styles from './AiAssistantSubstance.module.scss';

const moduleClass = styles['grw-ai-assistant-substance'] ?? '';

export const AiAssistantContent = (): JSX.Element => {
  const { t } = useTranslation();
  const { open } = useAiAssistantManagementModal();
  const { data: aiAssistantSidebarData, close: closeAiAssistantSidebar } = useAiAssistantSidebar();
  const { mutate: mutateRecentThreads } = useSWRINFxRecentThreads();
  const { data: aiAssistants, mutate: mutateAiAssistants } = useSWRxAiAssistants();

  const deleteAiAssistantHandler = useCallback(async(aiAssistantId: string) => {
    await mutateAiAssistants();
    await mutateRecentThreads();

    // If the sidebar is opened for the assistant being deleted, close it
    if (aiAssistantSidebarData?.isOpened && aiAssistantSidebarData?.aiAssistantData?._id === aiAssistantId) {
      closeAiAssistantSidebar();
    }
  }, [aiAssistantSidebarData?.aiAssistantData?._id, aiAssistantSidebarData?.isOpened, closeAiAssistantSidebar, mutateAiAssistants, mutateRecentThreads]);

  return (
    <div className={moduleClass}>
      <button
        type="button"
        className="btn btn-outline-secondary px-3 d-flex align-items-center mb-4"
        onClick={() => open()}
      >
        <span className="material-symbols-outlined fs-5 me-2">add</span>
        <span className="fw-normal">{t('ai_assistant_substance.add_assistant')}</span>
      </button>

      <div className="d-flex flex-column gap-4">
        <div>
          <AiAssistantList
            onUpdated={mutateAiAssistants}
            onDeleted={deleteAiAssistantHandler}
            onCollapsed={mutateAiAssistants}
            aiAssistants={aiAssistants?.myAiAssistants ?? []}
          />
        </div>

        <div>
          <AiAssistantList
            isTeamAssistant
            onUpdated={mutateAiAssistants}
            onCollapsed={mutateAiAssistants}
            aiAssistants={aiAssistants?.teamAiAssistants ?? []}
          />
        </div>

        <div>
          <h3 className="fw-bold grw-ai-assistant-substance-header">
            {t('ai_assistant_substance.recent_threads')}
          </h3>
          <ThreadList />
        </div>
      </div>
    </div>
  );
};
