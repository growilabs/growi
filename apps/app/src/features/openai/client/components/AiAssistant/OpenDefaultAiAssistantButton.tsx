import React, { type JSX, useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';

import { NotAvailable } from '~/client/components/NotAvailable';
import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { useGrowiAppIdForGrowiCloud, useGrowiCloudUri } from '~/states/global';
import { aiEnabledAtom } from '~/states/server-configurations';

import { useAiAssistantSidebarActions } from '../../states';
import { useSWRxAiAssistants } from '../../stores/ai-assistant';

import styles from './OpenDefaultAiAssistantButton.module.scss';

const AiAssistantButton = ({
  onClick,
}: {
  onClick?: () => void;
}): JSX.Element => (
  <button
    type="button"
    className={`btn btn-search ${styles['btn-open-default-ai-assistant']}`}
    onClick={onClick}
  >
    <span className="growi-custom-icons fs-4 align-middle lh-1">
      ai_assistant
    </span>
  </button>
);

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
        <AiAssistantButton onClick={openDefaultAiAssistantButtonClickHandler} />
      </NotAvailable>
    </NotAvailableForGuest>
  );
};

const OpenDefaultAiAssistantButton = (): JSX.Element => {
  const isAiEnabled = useAtomValue(aiEnabledAtom);
  const { t } = useTranslation();
  const growiCloudUri = useGrowiCloudUri();
  const growiAppIdForGrowiCloud = useGrowiAppIdForGrowiCloud();
  const isCloud = growiCloudUri != null && growiAppIdForGrowiCloud != null;

  if (!isAiEnabled) {
    if (!isCloud) return <></>;

    return (
      <NotAvailable
        isDisabled
        title={
          <>
            <p className="mb-2">
              {t('default_ai_assistant.open_cloud_settings_to_enable')}
            </p>
            <a href={`${growiCloudUri}/my/apps/${growiAppIdForGrowiCloud}`}>
              <span
                className="material-symbols-outlined me-1"
                style={{ fontSize: '1rem', verticalAlign: 'middle' }}
              >
                share
              </span>
              {t('default_ai_assistant.to_cloud_settings')}
            </a>
          </>
        }
      >
        <AiAssistantButton />
      </NotAvailable>
    );
  }

  return <OpenDefaultAiAssistantButtonSubstance />;
};

export default OpenDefaultAiAssistantButton;
