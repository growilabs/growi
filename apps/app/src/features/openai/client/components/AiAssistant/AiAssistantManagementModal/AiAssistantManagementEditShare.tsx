import React, {
  useCallback, useState, useEffect, type JSX,
} from 'react';

import { useTranslation } from 'react-i18next';
import {
  ModalBody, Input, Label,
} from 'reactstrap';

import { AiAssistantShareScope, AiAssistantAccessScope } from '~/features/openai/interfaces/ai-assistant';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import { useSWRxUserRelatedGroups } from '~/stores/user';

import { AccessScopeDropdown } from './AccessScopeDropdown';
import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { SelectUserGroupModal } from './SelectUserGroupModal';
import { ShareScopeSwitch } from './ShareScopeSwitch';

const ScopeType = {
  ACCESS: 'Access',
  SHARE: 'Share',
} as const;

type ScopeType = typeof ScopeType[keyof typeof ScopeType];

type Props = {
  selectedShareScope: AiAssistantShareScope,
  selectedAccessScope: AiAssistantAccessScope,
  selectedUserGroupsForShareScope: PopulatedGrantedGroup[],
  selectedUserGroupsForAccessScope: PopulatedGrantedGroup[],
  onSelectShareScope: (scope: AiAssistantShareScope) => void,
  onSelectAccessScope: (scope: AiAssistantAccessScope) => void,
  onSelectShareScopeUserGroups: (userGroup: PopulatedGrantedGroup) => void,
  onSelectAccessScopeUserGroups: (userGroup: PopulatedGrantedGroup) => void,
}

export const AiAssistantManagementEditShare = (props: Props): JSX.Element => {
  const {
    selectedShareScope,
    selectedAccessScope,
    selectedUserGroupsForShareScope,
    selectedUserGroupsForAccessScope,
    onSelectShareScope,
    onSelectAccessScope,
    onSelectShareScopeUserGroups,
    onSelectAccessScopeUserGroups,
  } = props;

  const { t } = useTranslation();
  const { data: userRelatedGroups } = useSWRxUserRelatedGroups();
  const hasNoRelatedGroups = userRelatedGroups == null || userRelatedGroups.relatedGroups.length === 0;

  const [isShared, setIsShared] = useState(false);
  const [isSelectUserGroupModalOpen, setIsSelectUserGroupModalOpen] = useState(false);
  const [selectedUserGroupType, setSelectedUserGroupType] = useState<ScopeType>(ScopeType.ACCESS);

  useEffect(() => {
    setIsShared(() => {
      if (selectedShareScope !== AiAssistantShareScope.SAME_AS_ACCESS_SCOPE) {
        return true;
      }
      return selectedShareScope === AiAssistantShareScope.SAME_AS_ACCESS_SCOPE && selectedAccessScope !== AiAssistantAccessScope.OWNER;
    });
  }, [isShared, selectedAccessScope, selectedShareScope]);

  const changeShareToggleHandler = useCallback(() => {
    setIsShared((prev) => {
      if (prev) { // if isShared === true
        onSelectShareScope(AiAssistantShareScope.SAME_AS_ACCESS_SCOPE);
        onSelectAccessScope(AiAssistantAccessScope.OWNER);
      }
      else {
        onSelectShareScope(AiAssistantShareScope.PUBLIC_ONLY);
      }
      return !prev;
    });
  }, [onSelectAccessScope, onSelectShareScope]);

  const selectGroupScopeHandler = useCallback((scopeType: ScopeType) => {
    setSelectedUserGroupType(scopeType);
    setIsSelectUserGroupModalOpen(true);
  }, []);

  const selectShareScopeHandler = useCallback((shareScope: AiAssistantShareScope) => {
    onSelectShareScope(shareScope);
    if (shareScope === AiAssistantShareScope.GROUPS && !hasNoRelatedGroups) {
      selectGroupScopeHandler(ScopeType.SHARE);
    }
  }, [hasNoRelatedGroups, onSelectShareScope, selectGroupScopeHandler]);

  const selectAccessScopeHandler = useCallback((accessScope: AiAssistantAccessScope) => {
    onSelectAccessScope(accessScope);
    if (accessScope === AiAssistantAccessScope.GROUPS && !hasNoRelatedGroups) {
      selectGroupScopeHandler(ScopeType.ACCESS);
    }
  }, [hasNoRelatedGroups, onSelectAccessScope, selectGroupScopeHandler]);


  return (
    <>
      <AiAssistantManagementHeader labelTranslationKey="modal_ai_assistant.page_mode_title.share" />

      <ModalBody className="px-4">
        <div className="form-check form-switch mb-4">
          <Input
            type="switch"
            role="switch"
            id="shareAssistantSwitch"
            className="form-check-input"
            checked={isShared}
            onChange={changeShareToggleHandler}
          />
          <Label className="form-check-label" for="shareAssistantSwitch">
            {t('modal_ai_assistant.share_assistant')}
          </Label>
        </div>

        <AccessScopeDropdown
          isDisabled={!isShared}
          isDisabledGroups={hasNoRelatedGroups}
          selectedAccessScope={selectedAccessScope}
          onSelect={selectAccessScopeHandler}
        />

        <ShareScopeSwitch
          isDisabled={!isShared}
          isDisabledGroups={hasNoRelatedGroups}
          selectedShareScope={selectedShareScope}
          onSelect={selectShareScopeHandler}
        />

        <SelectUserGroupModal
          isOpen={isSelectUserGroupModalOpen}
          userRelatedGroups={userRelatedGroups?.relatedGroups}
          closeModal={() => setIsSelectUserGroupModalOpen(false)}
          selectedUserGroups={selectedUserGroupType === ScopeType.ACCESS ? selectedUserGroupsForAccessScope : selectedUserGroupsForShareScope}
          onSelect={(userGroup) => {
            if (selectedUserGroupType === ScopeType.ACCESS) {
              onSelectAccessScopeUserGroups(userGroup);
            }
            else {
              onSelectShareScopeUserGroups(userGroup);
            }
          }}
        />
      </ModalBody>
    </>
  );
};
