import type React from 'react';
import { useCallback, useState } from 'react';
import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import { useTranslation } from 'react-i18next';
import { Collapse } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';
import loggerFactory from '~/utils/logger';

import {
  type AiAssistantHasId,
  AiAssistantShareScope,
} from '../../../../interfaces/ai-assistant';
import { determineShareScope } from '../../../../utils/determine-share-scope';
import {
  deleteAiAssistant,
  setDefaultAiAssistant,
} from '../../../services/ai-assistant';
import { useAiAssistantSidebarActions } from '../../../states';
import { useAiAssistantManagementModalActions } from '../../../states/modal/ai-assistant-management';
import { getShareScopeIcon } from '../../../utils/get-share-scope-Icon';
import { DeleteAiAssistantModalLazyLoaded } from './DeleteAiAssistantModal';

const logger = loggerFactory('growi:openai:client:components:AiAssistantList');

/*
 *  AiAssistantItem
 */
type AiAssistantItemProps = {
  currentUser?: IUserHasId | null;
  aiAssistant: AiAssistantHasId;
  onEditClick: (aiAssistantData: AiAssistantHasId) => void;
  onItemClick: (aiAssistantData: AiAssistantHasId) => void;
  onDeleteClick: (aiAssistant: AiAssistantHasId) => void;
  onUpdated?: () => void;
};

const AiAssistantItem: React.FC<AiAssistantItemProps> = ({
  currentUser,
  aiAssistant,
  onEditClick,
  onItemClick,
  onDeleteClick,
  onUpdated,
}) => {
  const { t } = useTranslation();

  const openManagementModalHandler = useCallback(
    (aiAssistantData: AiAssistantHasId) => {
      onEditClick(aiAssistantData);
    },
    [onEditClick],
  );

  const openChatHandler = useCallback(
    (aiAssistantData: AiAssistantHasId) => {
      onItemClick(aiAssistantData);
    },
    [onItemClick],
  );

  const setDefaultAiAssistantHandler = useCallback(async () => {
    try {
      await setDefaultAiAssistant(aiAssistant._id, !aiAssistant.isDefault);
      onUpdated?.();
      toastSuccess(
        t('ai_assistant_substance.toaster.ai_assistant_set_default_success'),
      );
    } catch (err) {
      logger.error(err);
      toastError(
        t('ai_assistant_substance.toaster.ai_assistant_set_default_failed'),
      );
    }
  }, [aiAssistant._id, aiAssistant.isDefault, onUpdated, t]);

  const isOperable =
    currentUser?._id != null &&
    getIdStringForRef(aiAssistant.owner) === currentUser._id;
  const isPublicAiAssistantOperable =
    currentUser?.admin &&
    determineShareScope(aiAssistant.shareScope, aiAssistant.accessScope) ===
      AiAssistantShareScope.PUBLIC_ONLY;

  return (
    <li className="list-group-item border-0 p-0">
      <button
        type="button"
        className="btn btn-link list-group-item-action border-0 d-flex align-items-center rounded-1"
        onClick={(e) => {
          e.stopPropagation();
          openChatHandler(aiAssistant);
        }}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
      >
        <div className="d-flex justify-content-center">
          <span className="material-symbols-outlined fs-5">
            {getShareScopeIcon(aiAssistant.shareScope, aiAssistant.accessScope)}
          </span>
        </div>

        <div className="grw-item-title ps-1">
          <p className="text-truncate m-auto">{aiAssistant.name}</p>
        </div>

        <div className="grw-btn-actions opacity-0 d-flex justify-content-center">
          {isPublicAiAssistantOperable && (
            <button
              type="button"
              className="btn btn-link text-secondary p-0"
              onClick={(e) => {
                e.stopPropagation();
                setDefaultAiAssistantHandler();
              }}
            >
              <span
                className={`material-symbols-outlined fs-5 ${aiAssistant.isDefault ? 'fill' : ''}`}
              >
                star
              </span>
            </button>
          )}
          {isOperable && (
            <>
              <button
                type="button"
                className="btn btn-link text-secondary p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  openManagementModalHandler(aiAssistant);
                }}
              >
                <span className="material-symbols-outlined fs-5">edit</span>
              </button>
              <button
                type="button"
                className="btn btn-link text-secondary p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteClick(aiAssistant);
                }}
              >
                <span className="material-symbols-outlined fs-5">delete</span>
              </button>
            </>
          )}
        </div>
      </button>
    </li>
  );
};

/*
 *  AiAssistantList
 */
type AiAssistantListProps = {
  isTeamAssistant?: boolean;
  aiAssistants: AiAssistantHasId[];
  onUpdated?: () => void;
  onDeleted?: (aiAssistantId: string) => void;
  onCollapsed?: () => void;
};

export const AiAssistantList: React.FC<AiAssistantListProps> = ({
  isTeamAssistant,
  aiAssistants,
  onUpdated,
  onDeleted,
  onCollapsed,
}) => {
  const { t } = useTranslation();
  const { openChat } = useAiAssistantSidebarActions();
  const currentUser = useCurrentUser();
  const { open: openAiAssistantManagementModal } =
    useAiAssistantManagementModalActions();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const [aiAssistantToBeDeleted, setAiAssistantToBeDeleted] =
    useState<AiAssistantHasId | null>(null);
  const [isDeleteModalShown, setIsDeleteModalShown] = useState(false);
  const [errorMessageOnDelete, setErrorMessageOnDelete] = useState('');

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      if (!prev) {
        onCollapsed?.();
      }
      return !prev;
    });
  }, [onCollapsed]);

  const onClickDeleteButton = useCallback((aiAssistant: AiAssistantHasId) => {
    setAiAssistantToBeDeleted(aiAssistant);
    setIsDeleteModalShown(true);
  }, []);

  const onCancelDeleteAiAssistant = useCallback(() => {
    setAiAssistantToBeDeleted(null);
    setIsDeleteModalShown(false);
    setErrorMessageOnDelete('');
  }, []);

  const onDeleteAiAssistantAfterOperation = useCallback(
    (aiAssistantId: string) => {
      onCancelDeleteAiAssistant();
      onDeleted?.(aiAssistantId);
    },
    [onCancelDeleteAiAssistant, onDeleted],
  );

  const onDeleteAiAssistant = useCallback(async () => {
    if (aiAssistantToBeDeleted == null) return;

    try {
      await deleteAiAssistant(aiAssistantToBeDeleted._id);
      onDeleteAiAssistantAfterOperation(aiAssistantToBeDeleted._id);
      toastSuccess(
        t('ai_assistant_substance.toaster.ai_assistant_deleted_success'),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessageOnDelete(message);
      logger.error(err);
      toastError(
        t('ai_assistant_substance.toaster.ai_assistant_deleted_failed'),
      );
    }
  }, [aiAssistantToBeDeleted, onDeleteAiAssistantAfterOperation, t]);

  return (
    <>
      <button
        type="button"
        className="btn btn-link p-0 text-secondary d-flex align-items-center"
        aria-expanded={!isCollapsed}
        onClick={toggleCollapse}
        disabled={aiAssistants.length === 0}
      >
        <h3 className="grw-ai-assistant-substance-header fw-bold mb-0 me-1">
          {t(
            `ai_assistant_substance.${isTeamAssistant ? 'team' : 'my'}_assistants`,
          )}
        </h3>
        <span className="material-symbols-outlined">
          {`keyboard_arrow_${isCollapsed ? 'down' : 'right'}`}
        </span>
      </button>

      <Collapse isOpen={isCollapsed}>
        <ul className="list-group">
          {aiAssistants.map((assistant) => (
            <AiAssistantItem
              key={assistant._id}
              currentUser={currentUser}
              aiAssistant={assistant}
              onEditClick={openAiAssistantManagementModal}
              onItemClick={openChat}
              onDeleteClick={onClickDeleteButton}
              onUpdated={onUpdated}
            />
          ))}
        </ul>
      </Collapse>

      <DeleteAiAssistantModalLazyLoaded
        isShown={isDeleteModalShown}
        aiAssistant={aiAssistantToBeDeleted}
        errorMessage={errorMessageOnDelete}
        onCancel={onCancelDeleteAiAssistant}
        onConfirm={onDeleteAiAssistant}
      />
    </>
  );
};
