import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { IThreadRelationHasId } from '~/features/openai/interfaces/thread-relation';

import { useAiAssistantSidebar } from '../../../stores/ai-assistant';
import { useSWRxThreads } from '../../../stores/thread';

import styles from './ThreadList.module.scss';

const moduleClass = styles['thread-list'] ?? '';

export const ThreadList: React.FC = () => {
  const { t } = useTranslation();
  const { openChat, data: aiAssistantSidebarData } = useAiAssistantSidebar();
  const { data: threads } = useSWRxThreads(
    aiAssistantSidebarData?.aiAssistantData?._id,
  );

  const openChatHandler = useCallback(
    (threadData: IThreadRelationHasId) => {
      const aiAssistantData = aiAssistantSidebarData?.aiAssistantData;
      if (aiAssistantData == null) {
        return;
      }

      openChat(aiAssistantData, threadData);
    },
    [aiAssistantSidebarData?.aiAssistantData, openChat],
  );

  if (threads == null || threads.length === 0) {
    return (
      <p className="text-body-secondary">
        {t('sidebar_ai_assistant.no_recent_chat')}
      </p>
    );
  }

  return (
    <>
      <ul className={`list-group ${moduleClass}`}>
        {threads.map((thread) => (
          <li
            key={thread._id}
            className="list-group-item border-0 rounded-1 bg-body-tertiary mb-2"
          >
            <button
              type="button"
              className="btn btn-link d-flex align-items-center list-group-item-action border-0 rounded-1 p-0"
              onClick={() => {
                openChatHandler(thread);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
            >
              <div className="text-body-secondary">
                <span className="material-symbols-outlined fs-5 me-2">
                  chat
                </span>
                <span className="flex-grow-1">{thread.title}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};
