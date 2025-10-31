import React, {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Input, ModalBody, ModalFooter } from 'reactstrap';

import {
  AiAssistantAccessScope,
  AiAssistantShareScope,
} from '~/features/openai/interfaces/ai-assistant';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import {
  useCurrentUser,
  useLimitLearnablePageCountPerAssistant,
} from '~/stores-universal/context';

import type { SelectablePage } from '../../../../interfaces/selectable-page';
import { determineShareScope } from '../../../../utils/determine-share-scope';
import {
  AiAssistantManagementModalPageMode,
  useAiAssistantManagementModal,
} from '../../../stores/ai-assistant';
import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { ShareScopeWarningModal } from './ShareScopeWarningModal';

type Props = {
  isActivePane: boolean;
  shouldEdit: boolean;
  name: string;
  description: string;
  instruction: string;
  shareScope: AiAssistantShareScope;
  accessScope: AiAssistantAccessScope;
  selectedPages: SelectablePage[];
  selectedUserGroupsForAccessScope: PopulatedGrantedGroup[];
  selectedUserGroupsForShareScope: PopulatedGrantedGroup[];
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onUpsertAiAssistant: () => Promise<void>;
};

export const AiAssistantManagementHome = (props: Props): JSX.Element => {
  const {
    isActivePane,
    shouldEdit,
    name,
    description,
    instruction,
    shareScope,
    accessScope,
    selectedPages,
    selectedUserGroupsForAccessScope,
    selectedUserGroupsForShareScope,
    onNameChange,
    onDescriptionChange,
    onUpsertAiAssistant,
  } = props;

  const { t } = useTranslation();
  const { data: currentUser } = useCurrentUser();
  const { data: limitLearnablePageCountPerAssistant } =
    useLimitLearnablePageCountPerAssistant();
  const { close: closeAiAssistantManagementModal, changePageMode } =
    useAiAssistantManagementModal();

  const [isShareScopeWarningModalOpen, setIsShareScopeWarningModalOpen] =
    useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const totalSelectedPageCount = useMemo(() => {
    return selectedPages.reduce((total, selectedPage) => {
      const descendantCount = selectedPage.descendantCount ?? 0;
      const pageCountWithDescendants = descendantCount + 1;
      return total + pageCountWithDescendants;
    }, 0);
  }, [selectedPages]);

  const getShareScopeLabel = useCallback(
    (shareScope: AiAssistantShareScope) => {
      const baseLabel = `modal_ai_assistant.share_scope.${shareScope}.label`;
      return shareScope === AiAssistantShareScope.OWNER
        ? t(baseLabel, { username: currentUser?.username })
        : t(baseLabel);
    },
    [currentUser?.username, t],
  );

  const canUpsert =
    name !== '' &&
    selectedPages.length !== 0 &&
    (limitLearnablePageCountPerAssistant ?? 3000) >= totalSelectedPageCount;

  const upsertAiAssistantHandler = useCallback(async () => {
    const shouldWarning = () => {
      const isDifferentUserGroup = () => {
        const selectedShareScopeUserGroupIds =
          selectedUserGroupsForShareScope.map(
            (userGroup) => userGroup.item._id,
          );
        const selectedAccessScopeUserGroupIds =
          selectedUserGroupsForAccessScope.map(
            (userGroup) => userGroup.item._id,
          );
        if (
          selectedShareScopeUserGroupIds.length !==
          selectedAccessScopeUserGroupIds.length
        ) {
          return false;
        }
        return selectedShareScopeUserGroupIds.every(
          (val, index) => val === selectedAccessScopeUserGroupIds[index],
        );
      };

      const determinedShareScope = determineShareScope(shareScope, accessScope);

      if (
        determinedShareScope === AiAssistantShareScope.PUBLIC_ONLY &&
        accessScope !== AiAssistantAccessScope.PUBLIC_ONLY
      ) {
        return true;
      }

      if (
        determinedShareScope === AiAssistantShareScope.OWNER &&
        accessScope !== AiAssistantAccessScope.OWNER
      ) {
        return true;
      }

      if (
        determinedShareScope === AiAssistantShareScope.GROUPS &&
        accessScope === AiAssistantAccessScope.OWNER
      ) {
        return true;
      }

      if (
        determinedShareScope === AiAssistantShareScope.GROUPS &&
        accessScope === AiAssistantAccessScope.GROUPS &&
        !isDifferentUserGroup()
      ) {
        return true;
      }

      return false;
    };

    if (shouldWarning()) {
      setIsShareScopeWarningModalOpen(true);
      return;
    }

    await onUpsertAiAssistant();
  }, [
    accessScope,
    onUpsertAiAssistant,
    selectedUserGroupsForAccessScope,
    selectedUserGroupsForShareScope,
    shareScope,
  ]);

  // Autofocus
  useEffect(() => {
    // Only when creating a new assistant
    if (isActivePane && !shouldEdit) {
      inputRef.current?.focus();
    }
  }, [isActivePane, shouldEdit]);

  return (
    <>
      <AiAssistantManagementHeader
        hideBackButton
        labelTranslationKey={
          shouldEdit
            ? 'modal_ai_assistant.header.update_assistant'
            : 'modal_ai_assistant.header.add_new_assistant'
        }
      />

      <div className="px-4">
        <ModalBody>
          <div className="mb-4 growi-ai-assistant-name">
            <Input
              type="text"
              placeholder={t('modal_ai_assistant.assistant_name_placeholder')}
              bsSize="lg"
              className="border-0 border-bottom border-2 px-0 rounded-0"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              innerRef={inputRef}
            />
          </div>

          <div className="mb-4">
            <div className="d-flex align-items-center mb-2">
              <span className="text-secondary">
                {t('modal_ai_assistant.memo.title')}
              </span>
              <span className="badge text-bg-secondary ms-2">
                {t('modal_ai_assistant.memo.optional')}
              </span>
            </div>
            <Input
              type="textarea"
              placeholder={t('modal_ai_assistant.memo.placeholder')}
              rows="4"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
            <small className="text-secondary d-block mt-2">
              {t('modal_ai_assistant.memo.description')}
            </small>
          </div>

          <div>
            <button
              type="button"
              onClick={() => {
                changePageMode(AiAssistantManagementModalPageMode.SHARE);
              }}
              className="btn w-100 d-flex justify-content-between align-items-center py-3 mb-2 border-0"
            >
              <span className="fw-normal">
                {t('modal_ai_assistant.page_mode_title.share')}
              </span>
              <div className="d-flex align-items-center text-secondary">
                <span>{getShareScopeLabel(shareScope)}</span>
                <span className="material-symbols-outlined ms-2 align-middle">
                  chevron_right
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                changePageMode(AiAssistantManagementModalPageMode.PAGES);
              }}
              className="btn w-100 d-flex justify-content-between align-items-center py-3 mb-2 border-0"
            >
              <span className="fw-normal">
                {t('modal_ai_assistant.page_mode_title.pages')}
              </span>
              <div className="d-flex align-items-center text-secondary">
                <span>
                  {t('modal_ai_assistant.page_count', {
                    count: totalSelectedPageCount,
                  })}
                </span>
                <span className="material-symbols-outlined ms-2 align-middle">
                  chevron_right
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                changePageMode(AiAssistantManagementModalPageMode.INSTRUCTION);
              }}
              className="btn w-100 d-flex justify-content-between align-items-center py-3 mb-2 border-0"
            >
              <span className="fw-normal">
                {t('modal_ai_assistant.page_mode_title.instruction')}
              </span>
              <div className="d-flex align-items-center text-secondary">
                <span className="text-truncate" style={{ maxWidth: '280px' }}>
                  {instruction}
                </span>
                <span className="material-symbols-outlined ms-2 align-middle">
                  chevron_right
                </span>
              </div>
            </button>
          </div>
        </ModalBody>

        <ModalFooter>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={closeAiAssistantManagementModal}
          >
            {t('Cancel')}
          </button>

          <button
            type="button"
            disabled={!canUpsert}
            className="btn btn-primary"
            onClick={upsertAiAssistantHandler}
          >
            {t(
              shouldEdit
                ? 'modal_ai_assistant.submit_button.update_assistant'
                : 'modal_ai_assistant.submit_button.create_assistant',
            )}
          </button>
        </ModalFooter>
      </div>

      <ShareScopeWarningModal
        isOpen={isShareScopeWarningModalOpen}
        selectedPages={selectedPages}
        closeModal={() => setIsShareScopeWarningModalOpen(false)}
        onSubmit={onUpsertAiAssistant}
      />
    </>
  );
};
