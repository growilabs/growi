import React, {
  useCallback, useState, useEffect, useMemo, type JSX,
} from 'react';

import type { IPageHasId } from '@growi/core';
import {
  type IGrantedGroup, isPopulated,
} from '@growi/core';
import { isGlobPatternPath } from '@growi/core/dist/utils/page-path-utils';
import { useTranslation } from 'react-i18next';
import { Modal, TabContent, TabPane } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';
import { AiAssistantAccessScope, AiAssistantShareScope } from '~/features/openai/interfaces/ai-assistant';
import type { IPagePathWithDescendantCount } from '~/interfaces/page';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import { useSWRxPagePathsWithDescendantCount } from '~/stores/page';
import loggerFactory from '~/utils/logger';

import type { SelectablePage } from '../../../../interfaces/selectable-page';
import { removeGlobPath } from '../../../../utils/remove-glob-path';
import { createAiAssistant, updateAiAssistant } from '../../../services/ai-assistant';
import { useAiAssistantSidebarStatus, useAiAssistantSidebarActions } from '../../../states';
import {
  useAiAssistantManagementModalStatus,
  useAiAssistantManagementModalActions,
  AiAssistantManagementModalPageMode,
} from '../../../states/modal/ai-assistant-management';
import { useSWRxAiAssistants } from '../../../stores/ai-assistant';

import { AiAssistantManagementEditInstruction } from './AiAssistantManagementEditInstruction';
import { AiAssistantManagementEditPages } from './AiAssistantManagementEditPages';
import { AiAssistantManagementEditShare } from './AiAssistantManagementEditShare';
import { AiAssistantManagementHome } from './AiAssistantManagementHome';
import { AiAssistantKeywordSearch } from './AiAssistantManagementKeywordSearch';
import { AiAssistantManagementPageSelectionMethod } from './AiAssistantManagementPageSelectionMethod';
import { AiAssistantManagementPageTreeSelection } from './AiAssistantManagementPageTreeSelection';

import styles from './AiAssistantManagementModal.module.scss';

const moduleClass = styles['grw-ai-assistant-management'] ?? '';

const logger = loggerFactory('growi:openai:client:components:AiAssistantManagementModal');

// PopulatedGrantedGroup[] -> IGrantedGroup[]
const convertToGrantedGroups = (selectedGroups: PopulatedGrantedGroup[]): IGrantedGroup[] => {
  return selectedGroups.map(group => ({
    type: group.type,
    item: group.item._id,
  }));
};

// IGrantedGroup[] -> PopulatedGrantedGroup[]
const convertToPopulatedGrantedGroups = (selectedGroups: IGrantedGroup[]): PopulatedGrantedGroup[] => {
  const populatedGrantedGroups = selectedGroups.filter(group => isPopulated(group.item)) as PopulatedGrantedGroup[];
  return populatedGrantedGroups;
};

// Convert page path patterns to selectable pages
const convertToSelectedPages = (
    pagePathPatterns: string[],
    pagePathsWithDescendantCount: IPagePathWithDescendantCount[],
): SelectablePage[] => {
  return pagePathPatterns.map((pagePathPattern) => {
    const pathWithoutGlob = isGlobPatternPath(pagePathPattern) ? pagePathPattern.slice(0, -2) : pagePathPattern;
    const page = pagePathsWithDescendantCount.find(p => p.path === pathWithoutGlob);
    return {
      ...page,
      path: pagePathPattern,
    };
  });
};

const AiAssistantManagementModalSubstance = (): JSX.Element => {
  // Hooks
  const { t } = useTranslation();
  const { mutate: mutateAiAssistants } = useSWRxAiAssistants();
  const aiAssistantManagementModalData = useAiAssistantManagementModalStatus();
  const { close: closeAiAssistantManagementModal } = useAiAssistantManagementModalActions();
  const aiAssistantSidebarData = useAiAssistantSidebarStatus();
  const { refreshAiAssistantData } = useAiAssistantSidebarActions();
  const { data: pagePathsWithDescendantCount } = useSWRxPagePathsWithDescendantCount(
    removeGlobPath(aiAssistantManagementModalData?.aiAssistantData?.pagePathPatterns) ?? null,
    undefined,
    true,
    true,
  );

  const aiAssistant = aiAssistantManagementModalData?.aiAssistantData;
  const shouldEdit = aiAssistant != null;
  const pageMode = aiAssistantManagementModalData?.pageMode ?? AiAssistantManagementModalPageMode.HOME;

  // Memoized populated granted groups for access scope
  const populatedGrantedGroupsForAccessScope = useMemo(() => {
    return aiAssistant?.grantedGroupsForAccessScope
      ? convertToPopulatedGrantedGroups(aiAssistant.grantedGroupsForAccessScope)
      : [];
  }, [aiAssistant?.grantedGroupsForAccessScope]);

  // Memoized populated granted groups for share scope
  const populatedGrantedGroupsForShareScope = useMemo(() => {
    return aiAssistant?.grantedGroupsForShareScope
      ? convertToPopulatedGrantedGroups(aiAssistant.grantedGroupsForShareScope)
      : [];
  }, [aiAssistant?.grantedGroupsForShareScope]);


  // States
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [selectedShareScope, setSelectedShareScope] = useState<AiAssistantShareScope>(AiAssistantShareScope.SAME_AS_ACCESS_SCOPE);
  const [selectedAccessScope, setSelectedAccessScope] = useState<AiAssistantAccessScope>(AiAssistantAccessScope.OWNER);
  const [selectedUserGroupsForAccessScope, setSelectedUserGroupsForAccessScope] = useState<PopulatedGrantedGroup[]>([]);
  const [selectedUserGroupsForShareScope, setSelectedUserGroupsForShareScope] = useState<PopulatedGrantedGroup[]>([]);
  const [selectedPages, setSelectedPages] = useState<SelectablePage[]>([]);
  const [instruction, setInstruction] = useState<string>(t('modal_ai_assistant.default_instruction'));


  // Effects
  useEffect(() => {
    if (shouldEdit) {
      setName(aiAssistant.name);
      setDescription(aiAssistant.description);
      setInstruction(aiAssistant.additionalInstruction);
      setSelectedShareScope(aiAssistant.shareScope);
      setSelectedAccessScope(aiAssistant.accessScope);
      setSelectedUserGroupsForShareScope(populatedGrantedGroupsForShareScope);
      setSelectedUserGroupsForAccessScope(populatedGrantedGroupsForAccessScope);
    }
  // eslint-disable-next-line max-len
  }, [aiAssistant?.accessScope, aiAssistant?.additionalInstruction, aiAssistant?.description, aiAssistant?.name, aiAssistant?.pagePathPatterns, aiAssistant?.shareScope, shouldEdit, populatedGrantedGroupsForShareScope, populatedGrantedGroupsForAccessScope]);

  useEffect(() => {
    if (shouldEdit && pagePathsWithDescendantCount != null) {
      setSelectedPages(convertToSelectedPages(aiAssistant.pagePathPatterns, pagePathsWithDescendantCount));
    }
  }, [aiAssistant?.pagePathPatterns, pagePathsWithDescendantCount, shouldEdit]);


  /*
  *  For AiAssistantManagementKeywordSearch & AiAssistantManagementPageTreeSelection methods
  */
  const selectPageHandler = useCallback((pages: IPageHasId[]) => {
    setSelectedPages(pages);
  }, []);


  /*
  *  For AiAssistantManagementHome methods
  */
  const changeNameHandler = (value: string) => {
    setName(value);
  };

  const changeDescriptionHandler = (value: string) => {
    setDescription(value);
  };

  // Memoized request body for upsert operation
  const requestBodyData = useMemo(() => {
    const pagePathPatterns = selectedPages.map(selectedPage => selectedPage.path);

    const grantedGroupsForShareScope = selectedShareScope === AiAssistantShareScope.GROUPS
      ? convertToGrantedGroups(selectedUserGroupsForShareScope)
      : undefined;

    const grantedGroupsForAccessScope = selectedAccessScope === AiAssistantAccessScope.GROUPS
      ? convertToGrantedGroups(selectedUserGroupsForAccessScope)
      : undefined;

    return {
      name,
      description,
      additionalInstruction: instruction,
      pagePathPatterns,
      shareScope: selectedShareScope,
      accessScope: selectedAccessScope,
      grantedGroupsForShareScope,
      grantedGroupsForAccessScope,
    };
  }, [
    selectedPages,
    selectedShareScope,
    selectedUserGroupsForShareScope,
    selectedAccessScope,
    selectedUserGroupsForAccessScope,
    name,
    description,
    instruction,
  ]);

  const upsertAiAssistantHandler = useCallback(async() => {
    try {
      if (shouldEdit) {
        const updatedAiAssistant = await updateAiAssistant(aiAssistant._id, requestBodyData);
        if (aiAssistantSidebarData?.aiAssistantData?._id === updatedAiAssistant._id) {
          refreshAiAssistantData(updatedAiAssistant);
        }
      }
      else {
        await createAiAssistant(requestBodyData);
      }

      toastSuccess(shouldEdit ? t('modal_ai_assistant.toaster.update_success') : t('modal_ai_assistant.toaster.create_success'));
      mutateAiAssistants();
      closeAiAssistantManagementModal();
    }
    catch (err) {
      toastError(shouldEdit ? t('modal_ai_assistant.toaster.update_failed') : t('modal_ai_assistant.toaster.create_failed'));
      logger.error(err);
    }
  }, [
    shouldEdit,
    requestBodyData,
    aiAssistant?._id,
    aiAssistantSidebarData?.aiAssistantData?._id,
    refreshAiAssistantData,
    t,
    mutateAiAssistants,
    closeAiAssistantManagementModal,
  ]);


  /*
  *  For AiAssistantManagementEditShare methods
  */
  const selectShareScopeHandler = (shareScope: AiAssistantShareScope) => {
    setSelectedShareScope(shareScope);
  };

  const selectAccessScopeHandler = (accessScope: AiAssistantAccessScope) => {
    setSelectedAccessScope(accessScope);
  };

  // Memoized user group selection handlers
  const selectShareScopeUserGroups = useCallback((targetUserGroup: PopulatedGrantedGroup) => {
    setSelectedUserGroupsForShareScope((prev) => {
      const selectedUserGroupIds = prev.map(userGroup => userGroup.item._id);
      if (selectedUserGroupIds.includes(targetUserGroup.item._id)) {
        // if selected, remove it
        return prev.filter(userGroup => userGroup.item._id !== targetUserGroup.item._id);
      }
      // if not selected, add it
      return [...prev, targetUserGroup];
    });
  }, []);

  const selectAccessScopeUserGroups = useCallback((targetUserGroup: PopulatedGrantedGroup) => {
    setSelectedUserGroupsForAccessScope((prev) => {
      const selectedUserGroupIds = prev.map(userGroup => userGroup.item._id);
      if (selectedUserGroupIds.includes(targetUserGroup.item._id)) {
        // if selected, remove it
        return prev.filter(userGroup => userGroup.item._id !== targetUserGroup.item._id);
      }
      // if not selected, add it
      return [...prev, targetUserGroup];
    });
  }, []);


  /*
  *  For AiAssistantManagementEditPages methods
  */
  const removePageHandler = useCallback((pagePath: string) => {
    setSelectedPages(prev => prev.filter(selectedPage => selectedPage.path !== pagePath));
  }, []);


  /*
  *  For AiAssistantManagementEditInstruction methods
  */
  const changeInstructionHandler = (value: string) => {
    setInstruction(value);
  };

  const resetInstructionHandler = useCallback(() => {
    setInstruction(t('modal_ai_assistant.default_instruction'));
  }, [t]);

  return (
    <>
      <TabContent activeTab={pageMode}>
        <TabPane tabId={AiAssistantManagementModalPageMode.PAGE_SELECTION_METHOD}>
          <AiAssistantManagementPageSelectionMethod />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.KEYWORD_SEARCH}>
          <AiAssistantKeywordSearch
            isActivePane={pageMode === AiAssistantManagementModalPageMode.KEYWORD_SEARCH}
            baseSelectedPages={selectedPages}
            updateBaseSelectedPages={selectPageHandler}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.PAGE_TREE_SELECTION}>
          <AiAssistantManagementPageTreeSelection
            baseSelectedPages={selectedPages}
            updateBaseSelectedPages={selectPageHandler}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.HOME}>
          <AiAssistantManagementHome
            isActivePane={pageMode === AiAssistantManagementModalPageMode.HOME}
            shouldEdit={shouldEdit}
            name={name}
            description={description}
            shareScope={selectedShareScope}
            accessScope={selectedAccessScope}
            instruction={instruction}
            selectedPages={selectedPages}
            selectedUserGroupsForShareScope={selectedUserGroupsForShareScope}
            selectedUserGroupsForAccessScope={selectedUserGroupsForAccessScope}
            onNameChange={changeNameHandler}
            onDescriptionChange={changeDescriptionHandler}
            onUpsertAiAssistant={upsertAiAssistantHandler}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.SHARE}>
          <AiAssistantManagementEditShare
            selectedShareScope={selectedShareScope}
            selectedAccessScope={selectedAccessScope}
            selectedUserGroupsForShareScope={selectedUserGroupsForShareScope}
            selectedUserGroupsForAccessScope={selectedUserGroupsForAccessScope}
            onSelectShareScope={selectShareScopeHandler}
            onSelectAccessScope={selectAccessScopeHandler}
            onSelectAccessScopeUserGroups={selectAccessScopeUserGroups}
            onSelectShareScopeUserGroups={selectShareScopeUserGroups}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.PAGES}>
          <AiAssistantManagementEditPages
            selectedPages={selectedPages}
            onRemove={removePageHandler}
          />
        </TabPane>

        <TabPane tabId={AiAssistantManagementModalPageMode.INSTRUCTION}>
          <AiAssistantManagementEditInstruction
            instruction={instruction}
            onChange={changeInstructionHandler}
            onReset={resetInstructionHandler}
          />
        </TabPane>
      </TabContent>
    </>
  );
};


export const AiAssistantManagementModal = (): JSX.Element => {
  const aiAssistantManagementModalData = useAiAssistantManagementModalStatus();
  const { close: closeAiAssistantManagementModal } = useAiAssistantManagementModalActions();

  const isOpened = aiAssistantManagementModalData?.isOpened ?? false;

  return (
    <Modal size="lg" isOpen={isOpened} toggle={closeAiAssistantManagementModal} className={moduleClass}>
      { isOpened && (
        <AiAssistantManagementModalSubstance />
      ) }
    </Modal>
  );
};
