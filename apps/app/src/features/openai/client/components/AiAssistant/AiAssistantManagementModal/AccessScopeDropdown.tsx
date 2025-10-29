import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  Label,
  UncontrolledDropdown,
} from 'reactstrap';

import { useCurrentUser } from '~/stores-universal/context';

import { AiAssistantAccessScope } from '../../../../interfaces/ai-assistant';

type Props = {
  isDisabled: boolean;
  isDisabledGroups: boolean;
  selectedAccessScope: AiAssistantAccessScope;
  onSelect: (accessScope: AiAssistantAccessScope) => void;
};

export const AccessScopeDropdown: React.FC<Props> = (props: Props) => {
  const { isDisabled, isDisabledGroups, selectedAccessScope, onSelect } = props;

  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUser();

  const getAccessScopeLabel = useCallback(
    (accessScope: AiAssistantAccessScope) => {
      const baseLabel = `modal_ai_assistant.access_scope.${accessScope}`;
      return accessScope === AiAssistantAccessScope.OWNER
        ? t(baseLabel, { username: currentUser?.username })
        : t(baseLabel);
    },
    [currentUser?.username, t],
  );

  const selectAccessScopeHandler = useCallback(
    (accessScope: AiAssistantAccessScope) => {
      onSelect(accessScope);
    },
    [onSelect],
  );

  return (
    <div className="mb-4">
      <Label className="text-secondary mb-2">
        {t('modal_ai_assistant.page_access_permission')}
      </Label>
      <UncontrolledDropdown>
        <DropdownToggle
          disabled={isDisabled}
          caret
          className="btn-outline-secondary bg-transparent"
        >
          {getAccessScopeLabel(selectedAccessScope)}
        </DropdownToggle>
        <DropdownMenu>
          {[
            AiAssistantAccessScope.OWNER,
            AiAssistantAccessScope.GROUPS,
            AiAssistantAccessScope.PUBLIC_ONLY,
          ].map((accessScope) => (
            <DropdownItem
              disabled={
                isDisabledGroups &&
                accessScope === AiAssistantAccessScope.GROUPS
              }
              onClick={() => selectAccessScopeHandler(accessScope)}
              key={accessScope}
            >
              {getAccessScopeLabel(accessScope)}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </UncontrolledDropdown>
    </div>
  );
};
