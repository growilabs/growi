import { useCallback, useState } from 'react';

import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';

import { exist, getIsNonUserRelatedGroupsGranted } from '~/client/services/page-operation';
import { toastWarning } from '~/client/util/toastr';
import type { IApiv3PageCreateParams } from '~/interfaces/apiv3';
import { useCurrentPagePath, useSetIsUntitledPage } from '~/states/page';
import { useEditorMode, EditorMode } from '~/states/ui/editor';
import { useGrantedGroupsInheritanceSelectModalActions } from '~/states/ui/modal/granted-groups-inheritance-select';

import { createPage } from './create-page';

/**
 * Invoked when creation and transition has finished
 */
type OnCreated = () => void;
/**
 * Invoked when either creation or transition has aborted
 */
type OnAborted = () => void;
/**
 * Always invoked after processing is terminated
 */
type OnTerminated = () => void;

export type CreatePageOpts = {
  skipPageExistenceCheck?: boolean,
  skipTransition?: boolean,
  onCreationStart?: OnCreated,
  onCreated?: OnCreated,
  onAborted?: OnAborted,
  onTerminated?: OnTerminated,
}

type CreatePage = (
  params: IApiv3PageCreateParams,
  opts?: CreatePageOpts,
) => Promise<void>;

type UseCreatePage = () => {
  isCreating: boolean,
  create: CreatePage,
};

export const useCreatePage: UseCreatePage = () => {

  const router = useRouter();
  const { t } = useTranslation();

  const currentPagePath = useCurrentPagePath();
  const { setEditorMode } = useEditorMode();
  const setIsUntitledPage = useSetIsUntitledPage();
  const { open: openGrantedGroupsInheritanceSelectModal, close: closeGrantedGroupsInheritanceSelectModal } = useGrantedGroupsInheritanceSelectModalActions();

  const [isCreating, setCreating] = useState(false);

  const create: CreatePage = useCallback(async (params, opts = {}) => {
    const {
      onCreationStart, onCreated, onAborted, onTerminated,
    } = opts;
    const skipPageExistenceCheck = opts.skipPageExistenceCheck ?? false;
    const skipTransition = opts.skipTransition ?? false;

    // check the page existence
    if (!skipPageExistenceCheck && params.path != null) {
      const pagePath = params.path;

      try {
        const { isExist } = await exist(pagePath);

        if (isExist) {
          if (!skipTransition) {
            // routing
            if (pagePath !== currentPagePath) {
              await router.push(`${pagePath}#edit`);
            }
            setEditorMode(EditorMode.Editor);
          }
          else {
            toastWarning(t('duplicated_page_alert.same_page_name_exists', { pageName: pagePath }));
          }
          onAborted?.();
          return;
        }
      }
      catch (err) {
        throw err;
      }
      finally {
        onTerminated?.();
      }
    }

    const _create = async (onlyInheritUserRelatedGrantedGroups?: boolean) => {
      try {
        setCreating(true);
        onCreationStart?.();

        params.onlyInheritUserRelatedGrantedGroups = onlyInheritUserRelatedGrantedGroups;
        const response = await createPage(params);

        closeGrantedGroupsInheritanceSelectModal();

        if (!skipTransition) {
          await router.push(`/${response.page._id}#edit`);
          setEditorMode(EditorMode.Editor);
        }

        if (params.path == null) {
          setIsUntitledPage(true);
        }

        onCreated?.();
      }
      catch (err) {
        throw err;
      }
      finally {
        onTerminated?.();
        setCreating(false);
      }
    };

    // If parent page is granted to non-user-related groups, let the user select whether or not to inherit them.
    if (params.parentPath != null) {
      const { isNonUserRelatedGroupsGranted } = await getIsNonUserRelatedGroupsGranted(params.parentPath);
      if (isNonUserRelatedGroupsGranted) {
        // create and transit request will be made from modal
        openGrantedGroupsInheritanceSelectModal(_create);
        return;
      }
    }

    await _create();
  }, [currentPagePath, setEditorMode, router, t, closeGrantedGroupsInheritanceSelectModal, setIsUntitledPage, openGrantedGroupsInheritanceSelectModal]);

  return {
    isCreating,
    create,
  };
};
