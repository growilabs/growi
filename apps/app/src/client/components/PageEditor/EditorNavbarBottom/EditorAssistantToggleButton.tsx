import { useCallback } from 'react';

import { useTranslation } from 'next-i18next';

import { useAiAssistantSidebar } from '~/features/openai/client/stores/ai-assistant';

export const EditorAssistantToggleButton = (): JSX.Element => {
  const { t } = useTranslation();
  const { data, close, openEditor } = useAiAssistantSidebar();
  const { isOpened } = data ?? {};

  const toggle = useCallback(() => {
    if (isOpened) {
      close();
      return;
    }

    openEditor();
  }, [isOpened, openEditor, close]);

  return (
    <button
      type="button"
      className={`btn btn-sm btn-outline-neutral-secondary py-0 ${data?.isOpened ? 'active' : ''}`}
      onClick={toggle}
    >
      <span className="d-flex align-items-center">
        <span className="material-symbols-outlined">support_agent</span>
        <span className="ms-1 me-1">{t('page_edit.editor_assistant')}</span>
      </span>
    </button>
  );
};
