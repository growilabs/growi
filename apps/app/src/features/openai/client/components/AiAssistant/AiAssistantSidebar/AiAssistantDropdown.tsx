import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledDropdown,
} from 'reactstrap';

import type { AiAssistantHasId } from '../../../../interfaces/ai-assistant';
import { useSWRxAiAssistants } from '../../../stores/ai-assistant';
import { getShareScopeIcon } from '../../../utils/get-share-scope-Icon';

type Props = {
  selectedAiAssistant?: AiAssistantHasId;
  onSelect(aiAssistant?: AiAssistantHasId): void;
};

export const AiAssistantDropdown = ({
  selectedAiAssistant,
  onSelect,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const { data: aiAssistantData } = useSWRxAiAssistants();

  const allAiAssistants = useMemo(() => {
    if (aiAssistantData == null) {
      return [];
    }
    return [
      ...aiAssistantData.myAiAssistants,
      ...aiAssistantData.teamAiAssistants,
    ];
  }, [aiAssistantData]);

  const getAiAssistantLabel = useCallback((aiAssistant: AiAssistantHasId) => {
    return (
      <>
        <span className="material-symbols-outlined fs-5 me-1">
          {getShareScopeIcon(aiAssistant.shareScope, aiAssistant.accessScope)}
        </span>
        {aiAssistant.name}
      </>
    );
  }, []);

  const selectAiAssistantHandler = useCallback(
    (aiAssistant?: AiAssistantHasId) => {
      onSelect(aiAssistant);
    },
    [onSelect],
  );

  return (
    <UncontrolledDropdown>
      <DropdownToggle
        className="btn btn-outline-secondary"
        disabled={allAiAssistants.length === 0}
      >
        {selectedAiAssistant != null ? (
          getAiAssistantLabel(selectedAiAssistant)
        ) : (
          <>
            <span className="material-symbols-outlined fs-5">Add</span>
            {t('sidebar_ai_assistant.use_assistant')}
          </>
        )}
      </DropdownToggle>
      <DropdownMenu>
        {allAiAssistants.map((aiAssistant) => {
          return (
            <DropdownItem
              key={aiAssistant._id}
              active={selectedAiAssistant?._id === aiAssistant._id}
              onClick={() => selectAiAssistantHandler(aiAssistant)}
            >
              {getAiAssistantLabel(aiAssistant)}
            </DropdownItem>
          );
        })}
        <DropdownItem divider />
        <DropdownItem onClick={() => selectAiAssistantHandler()}>
          {t('sidebar_ai_assistant.remove_assistant')}
        </DropdownItem>
      </DropdownMenu>
    </UncontrolledDropdown>
  );
};
