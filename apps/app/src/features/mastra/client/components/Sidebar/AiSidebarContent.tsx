import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatSidebarActions } from '../../status/chat-sidebar';
import { ThreadList } from './ThreadList';

import styles from './AiSidebarContent.module.scss';

const moduleClass = styles['grw-ai-sidebar-content'] ?? '';

export const AiSidebarContent = (): JSX.Element => {
  const { t } = useTranslation();
  const { openChat } = useChatSidebarActions();

  return (
    <div className={moduleClass}>
      <button
        type="button"
        className="btn btn-outline-secondary px-3 d-flex align-items-center mb-4"
        // No args: start a fresh, assistant-independent chat.
        onClick={() => openChat()}
      >
        <span className="material-symbols-outlined fs-5 me-2">add</span>
        <span className="fw-normal">{t('ai_sidebar.new_chat')}</span>
      </button>

      <div className="d-flex flex-column gap-4">
        <div>
          <h3 className="fw-bold grw-ai-sidebar-content-header">
            {t('ai_sidebar.recent_threads')}
          </h3>
          <ThreadList />
        </div>
      </div>
    </div>
  );
};
