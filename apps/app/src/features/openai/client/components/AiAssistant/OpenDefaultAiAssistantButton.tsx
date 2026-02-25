import React, { type JSX, useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { NotAvailable } from '~/client/components/NotAvailable';
import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { aiEnabledAtom } from '~/states/server-configurations';

import { useAiAssistantSidebarActions } from '../../states';
import { useSWRxAiAssistants } from '../../stores/ai-assistant';

import styles from './OpenDefaultAiAssistantButton.module.scss';

const OpenDefaultAiAssistantButtonSubstance = (): JSX.Element => {
  const { t } = useTranslation();
  const { data: aiAssistantData } = useSWRxAiAssistants();
  const { openChat } = useAiAssistantSidebarActions();

  const defaultAiAssistant = useMemo(() => {
    if (aiAssistantData == null) {
      return null;
    }

    const allAiAssistants = [
      ...aiAssistantData.myAiAssistants,
      ...aiAssistantData.teamAiAssistants,
    ];
    return allAiAssistants.find((aiAssistant) => aiAssistant.isDefault);
  }, [aiAssistantData]);

  const openDefaultAiAssistantButtonClickHandler = useCallback(() => {
    if (defaultAiAssistant == null) {
      return;
    }

    openChat(defaultAiAssistant);
  }, [defaultAiAssistant, openChat]);

  return (
    <NotAvailableForGuest>
      <NotAvailable
        isDisabled={defaultAiAssistant == null}
        title={t('default_ai_assistant.not_set')}
      >
        <button
          type="button"
          className={`btn btn-search ${styles['btn-open-default-ai-assistant']}`}
          onClick={openDefaultAiAssistantButtonClickHandler}
        >
          <span className="growi-custom-icons fs-4 align-middle lh-1">
            ai_assistant
          </span>
        </button>
      </NotAvailable>
    </NotAvailableForGuest>
  );
};

const OpenDefaultAiAssistantButton = (): JSX.Element => {
  const isAiEnabled = useAtomValue(aiEnabledAtom);

  if (!isAiEnabled) {
    return <></>;
  }

  return <OpenDefaultAiAssistantButtonSubstance />;
};

export default OpenDefaultAiAssistantButton;
