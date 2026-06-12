import React, { type JSX, useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type {
  IPageInfoForEntity,
  IPagePopulatedToShowRevision,
  IPageToRenameWithMeta,
  IPageWithMeta,
} from '@growi/core';
import { isPopulated } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor.js';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import Sticky from 'react-stickynode';
import { DropdownItem, Tooltip, UncontrolledTooltip } from 'reactstrap';

import {
  exportAsMarkdown,
  syncLatestRevisionBody,
  updateContentWidth,
} from '~/client/services/page-operation.js';
import { usePrintMode } from '~/client/services/use-print-mode.js';
import { toastError, toastSuccess, toastWarning } from '~/client/util/toastr.js';
import { GroundGlassBar } from '~/components/Navbar/GroundGlassBar.js';
import { PageReconcileMenuItem } from '~/features/growi-vault/client/components/PageReconcileMenuItem.js';
import { ReconcileTriggerModal } from '~/features/growi-vault/client/components/ReconcileTriggerModal.js';
import { usePageBulkExportSelectModalActions } from '~/features/page-bulk-export/client/states/modal.js';
import type {
  OnDeletedFunction,
  OnDuplicatedFunction,
  OnRenamedFunction,
} from '~/interfaces/ui.js';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content.js';
import {
  useIsGuestUser,
  useIsReadOnlyUser,
  useIsSharedUser,
} from '~/states/context.js';
import { useCurrentPathname, useCurrentUser } from '~/states/global/index.js';
import { useCurrentPageId, useFetchCurrentPage } from '~/states/page/index.js';
import { useShareLinkId } from '~/states/page/hooks.js';
import {
  disableLinkSharingAtom,
  isBulkExportPagesEnabledAtom,
  isLocalAccountRegistrationEnabledAtom,
  isUploadEnabledAtom,
} from '~/states/server-configurations/index.js';
import { useDeviceLargerThanMd } from '~/states/ui/device.js';
import { EditorMode, useEditorMode } from '~/states/ui/editor/index.js';
import {
  PageAccessoriesModalContents,
  usePageAccessoriesModalActions,
} from '~/states/ui/modal/page-accessories.js';
import { usePageDeleteModalActions } from '~/states/ui/modal/page-delete.js';
import {
  type IPageForPageDuplicateModal,
  usePageDuplicateModalActions,
} from '~/states/ui/modal/page-duplicate.js';
import { usePresentationModalActions } from '~/states/ui/modal/page-presentation.js';
import { usePageRenameModalActions } from '~/states/ui/modal/page-rename.js';
import {
  useIsAbleToChangeEditorMode,
  useIsAbleToShowPageManagement,
} from '~/states/ui/page-abilities.js';
import { useSWRxPageInfo } from '~/stores/page.js';
import { mutatePageTree, mutateRecentlyUpdated } from '~/stores/page-listing.js';

import { CreateTemplateModalLazyLoaded } from '../CreateTemplateModal/index.js';
import { NotAvailable } from '../NotAvailable.js';
import { Skeleton } from '../Skeleton.js';

import styles from './GrowiContextualSubNavigation.module.scss';
import PageEditorModeManagerStyles from './PageEditorModeManager.module.scss';

const moduleClass = styles['grw-contextual-sub-navigation'];
const minHeightSubNavigation = styles['grw-min-height-sub-navigation'];

const PageEditorModeManager = dynamic(
  () =>
    import('./PageEditorModeManager.js').then((mod) => mod.PageEditorModeManager),
  {
    ssr: false,
    loading: () => (
      <Skeleton
        additionalClass={`${PageEditorModeManagerStyles['grw-page-editor-mode-manager-skeleton']}`}
      />
    ),
  },
);
const PageControls = dynamic(
  () => import('../PageControls/index.js').then((mod) => mod.PageControls),
  { ssr: false, loading: () => <></> },
);

type PageOperationMenuItemsProps = {
  pageId: string;
  revisionId: string;
  isLinkSharingDisabled?: boolean;
};

const PageOperationMenuItems = (
  props: PageOperationMenuItemsProps,
): JSX.Element => {
  const { t } = useTranslation();

  const { pageId, revisionId, isLinkSharingDisabled } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isSharedUser = useIsSharedUser();
  const isBulkExportPagesEnabled = useAtomValue(isBulkExportPagesEnabledAtom);
  const isUploadEnabled = useAtomValue(isUploadEnabledAtom);

  const { open: openPresentationModal } = usePresentationModalActions();
  const { open: openAccessoriesModal } = usePageAccessoriesModalActions();
  const { open: openPageBulkExportSelectModal } =
    usePageBulkExportSelectModalActions();

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(
    GlobalCodeMirrorEditorKey.MAIN,
  );

  const [isBulkExportTooltipOpen, setIsBulkExportTooltipOpen] = useState(false);

  const syncLatestRevisionBodyHandler = useCallback(async () => {
    // biome-ignore lint/suspicious/noAlert: Allow to use confirm dialog here
    const answer = window.confirm(t('sync-latest-revision-body.confirm'));
    if (answer) {
      try {
        const editingMarkdownLength = codeMirrorEditor?.getDoc().length;
        const res = await syncLatestRevisionBody(pageId, editingMarkdownLength);

        if (!res.synced) {
          toastWarning(t('sync-latest-revision-body.skipped-toaster'));
          return;
        }

        if (res?.isYjsDataBroken) {
          // biome-ignore lint/suspicious/noAlert: Allow to use confirm dialog here
          window.alert(t('sync-latest-revision-body.alert'));
          return;
        }

        toastSuccess(t('sync-latest-revision-body.success-toaster'));
      } catch {
        toastError(t('sync-latest-revision-body.error-toaster'));
      }
    }
  }, [codeMirrorEditor, pageId, t]);

  return (
    <>
      <DropdownItem
        onClick={() => syncLatestRevisionBodyHandler()}
        className="grw-page-control-dropdown-item"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          sync
        </span>
        {t('sync-latest-revision-body.menuitem')}
      </DropdownItem>

      {/* Presentation */}
      <DropdownItem
        onClick={() => openPresentationModal()}
        data-testid="open-presentation-modal-btn"
        className="grw-page-control-dropdown-item"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          jamboard_kiosk
        </span>
        {t('Presentation Mode')}
      </DropdownItem>

      {/* Export markdown */}
      <DropdownItem
        onClick={() => exportAsMarkdown(pageId, revisionId, 'md')}
        className="grw-page-control-dropdown-item"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          cloud_download
        </span>
        {t('page_export.export_page_markdown')}
      </DropdownItem>

      {/* Bulk export */}
      {isBulkExportPagesEnabled && (
        <>
          <span id="bulkExportDropdownItem">
            <DropdownItem
              onClick={openPageBulkExportSelectModal}
              className="grw-page-control-dropdown-item"
              disabled={!isUploadEnabled}
            >
              <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
                cloud_download
              </span>
              {t('page_export.bulk_export')}
            </DropdownItem>
          </span>
          <Tooltip
            placement={window.innerWidth < 800 ? 'bottom' : 'left'}
            isOpen={!isUploadEnabled && isBulkExportTooltipOpen}
            // Tooltip cannot be activated when target is disabled so set the target to wrapper span
            target="bulkExportDropdownItem"
            toggle={() => setIsBulkExportTooltipOpen(!isBulkExportTooltipOpen)}
          >
            {t('page_export.file_upload_not_configured')}
          </Tooltip>
        </>
      )}

      <DropdownItem divider />

      {/*
        TODO: show Tooltip when menu is disabled
        refs: PageAccessoriesModalControl
      */}
      <DropdownItem
        onClick={() =>
          openAccessoriesModal(PageAccessoriesModalContents.PageHistory)
        }
        disabled={!!isGuestUser || !!isSharedUser}
        data-testid="open-page-accessories-modal-btn-with-history-tab"
        className="grw-page-control-dropdown-item"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          history
        </span>
        {t('History')}
      </DropdownItem>

      <DropdownItem
        onClick={() =>
          openAccessoriesModal(PageAccessoriesModalContents.Attachment)
        }
        data-testid="open-page-accessories-modal-btn-with-attachment-data-tab"
        className="grw-page-control-dropdown-item"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          attachment
        </span>
        {t('attachment_data')}
      </DropdownItem>

      {!isGuestUser && !isReadOnlyUser && !isSharedUser && (
        <NotAvailable
          isDisabled={isLinkSharingDisabled ?? false}
          title="Disabled by admin"
        >
          <DropdownItem
            onClick={() =>
              openAccessoriesModal(PageAccessoriesModalContents.ShareLink)
            }
            data-testid="open-page-accessories-modal-btn-with-share-link-management-data-tab"
            className="grw-page-control-dropdown-item"
          >
            <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
              share
            </span>
            {t('share_links.share_link_management')}
          </DropdownItem>
        </NotAvailable>
      )}
    </>
  );
};

type CreateTemplateMenuItemsProps = {
  onClickTemplateMenuItem: (isPageTemplateModalShown: boolean) => void;
};

const CreateTemplateMenuItems = (
  props: CreateTemplateMenuItemsProps,
): JSX.Element => {
  const { t } = useTranslation();

  const { onClickTemplateMenuItem } = props;

  const openPageTemplateModalHandler = () => {
    onClickTemplateMenuItem(true);
  };

  return (
    <>
      {/* Create template */}
      <DropdownItem
        onClick={openPageTemplateModalHandler}
        className="grw-page-control-dropdown-item"
        data-testid="open-page-template-modal-btn"
      >
        <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">
          contract_edit
        </span>
        {t('template.option_label.create/edit')}
      </DropdownItem>
    </>
  );
};

type GrowiContextualSubNavigationProps = {
  currentPage?: IPagePopulatedToShowRevision | null;
};

const GrowiContextualSubNavigation = (
  props: GrowiContextualSubNavigationProps,
): JSX.Element => {
  const { currentPage } = props;

  const { t } = useTranslation();

  const router = useRouter();
  const isPrinting = usePrintMode();

  const shareLinkId = useShareLinkId();
  const { fetchCurrentPage } = useFetchCurrentPage();

  const currentPathname = useCurrentPathname();
  const isSharedPage = pagePathUtils.isSharedPage(currentPathname ?? '');

  const revision = currentPage?.revision;
  const revisionId =
    revision != null && isPopulated(revision) ? revision._id : undefined;

  const { editorMode, setEditorMode } = useEditorMode();
  const pageId = useCurrentPageId(true);
  const currentUser = useCurrentUser();
  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isLocalAccountRegistrationEnabled = useAtomValue(
    isLocalAccountRegistrationEnabledAtom,
  );
  const isLinkSharingDisabled = useAtomValue(disableLinkSharingAtom);
  const isSharedUser = useIsSharedUser();

  const shouldExpandContent = useShouldExpandContent(currentPage);

  const isAbleToShowPageManagement = useIsAbleToShowPageManagement();
  const isAbleToChangeEditorMode = useIsAbleToChangeEditorMode();
  const [isDeviceLargerThanMd] = useDeviceLargerThanMd();

  const { open: openDuplicateModal } = usePageDuplicateModalActions();
  const { open: openRenameModal } = usePageRenameModalActions();
  const { open: openDeleteModal } = usePageDeleteModalActions();
  const { mutate: mutatePageInfo } = useSWRxPageInfo(pageId);

  const [isStickyActive, setStickyActive] = useState(false);

  const path = currentPage?.path ?? currentPathname;

  const [isPageTemplateModalShown, setIsPageTempleteModalShown] =
    useState(false);

  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);

  const duplicateItemClickedHandler = useCallback(
    async (page: IPageForPageDuplicateModal) => {
      const duplicatedHandler: OnDuplicatedFunction = (fromPath, toPath) => {
        router.push(toPath);
      };
      openDuplicateModal(page, { onDuplicated: duplicatedHandler });
    },
    [openDuplicateModal, router],
  );

  const renameItemClickedHandler = useCallback(
    async (page: IPageToRenameWithMeta<IPageInfoForEntity>) => {
      const renamedHandler: OnRenamedFunction = () => {
        fetchCurrentPage({ force: true });
        mutatePageInfo();
        mutatePageTree();
        mutateRecentlyUpdated();
      };
      openRenameModal(page, { onRenamed: renamedHandler });
    },
    [fetchCurrentPage, mutatePageInfo, openRenameModal],
  );

  const deleteItemClickedHandler = useCallback(
    (pageWithMeta: IPageWithMeta) => {
      const deletedHandler: OnDeletedFunction = (
        pathOrPathsToDelete,
        isRecursively,
        isCompletely,
      ) => {
        if (typeof pathOrPathsToDelete !== 'string') {
          return;
        }

        const path = pathOrPathsToDelete;

        if (isCompletely) {
          // redirect to NotFound Page
          setEditorMode(EditorMode.View);
          router.push(path);
        } else if (currentPathname != null) {
          router.push(currentPathname);
        }

        fetchCurrentPage({ force: true });
        mutatePageInfo();
        mutatePageTree();
        mutateRecentlyUpdated();
      };
      openDeleteModal([pageWithMeta], { onDeleted: deletedHandler });
    },
    [
      currentPathname,
      fetchCurrentPage,
      openDeleteModal,
      router,
      mutatePageInfo,
      setEditorMode,
    ],
  );

  const switchContentWidthHandler = useCallback(
    async (pageId: string, value: boolean) => {
      if (!isSharedPage) {
        await updateContentWidth(pageId, value);
        fetchCurrentPage({ force: true });
      }
    },
    [isSharedPage, fetchCurrentPage],
  );

  const additionalMenuItemsRenderer = useCallback(() => {
    if (revisionId == null || pageId == null) {
      return (
        <>
          {!isReadOnlyUser && (
            <CreateTemplateMenuItems
              onClickTemplateMenuItem={() => setIsPageTempleteModalShown(true)}
            />
          )}
        </>
      );
    }
    return (
      <>
        <PageOperationMenuItems
          pageId={pageId}
          revisionId={revisionId}
          isLinkSharingDisabled={isLinkSharingDisabled}
        />
        {path != null && (
          <>
            <DropdownItem divider />
            <PageReconcileMenuItem
              onClick={() => setIsReconcileModalOpen(true)}
            />
          </>
        )}
        {!isReadOnlyUser && (
          <>
            <DropdownItem divider />
            <CreateTemplateMenuItems
              onClickTemplateMenuItem={() => setIsPageTempleteModalShown(true)}
            />
          </>
        )}
      </>
    );
  }, [isLinkSharingDisabled, pageId, path, revisionId, isReadOnlyUser]);

  // hide sub controls when sticky on mobile device
  const hideSubControls = useMemo(() => {
    return !isDeviceLargerThanMd && isStickyActive;
  }, [isDeviceLargerThanMd, isStickyActive]);

  return (
    <>
      {/* for App Title for mobile */}
      <GroundGlassBar className="py-4 d-block d-md-none d-print-none border-bottom" />

      {/* for Sub Navigation */}
      <GroundGlassBar
        className={`position-fixed z-1 d-edit-none d-print-none w-100 end-0 ${minHeightSubNavigation}`}
      />

      <Sticky
        className="z-3"
        enabled={!isPrinting}
        onStateChange={(status) =>
          setStickyActive(status.status === Sticky.STATUS_FIXED)
        }
        innerActiveClass="w-100 end-0"
      >
        <nav
          className={`${moduleClass} ${minHeightSubNavigation}
            d-flex align-items-center justify-content-end pe-2 pe-sm-3 pe-md-4 py-1 gap-2 gap-md-4 d-print-none
          `}
          data-testid="grw-contextual-sub-nav"
          id="grw-contextual-sub-nav"
        >
          <PageControls
            pageId={pageId}
            revisionId={revisionId}
            shareLinkId={shareLinkId}
            path={path ?? currentPathname} // If the page is empty, "path" is undefined
            expandContentWidth={shouldExpandContent}
            disableSeenUserInfoPopover={isSharedUser}
            hideSubControls={hideSubControls}
            showPageControlDropdown={isAbleToShowPageManagement}
            additionalMenuItemRenderer={additionalMenuItemsRenderer}
            onClickDuplicateMenuItem={duplicateItemClickedHandler}
            onClickRenameMenuItem={renameItemClickedHandler}
            onClickDeleteMenuItem={deleteItemClickedHandler}
            onClickSwitchContentWidth={switchContentWidthHandler}
          />

          {isAbleToChangeEditorMode && (
            <PageEditorModeManager
              editorMode={editorMode}
              isBtnDisabled={!!isGuestUser || !!isReadOnlyUser}
              path={path}
            />
          )}

          {isGuestUser && (
            <div>
              <span>
                <span className="d-inline-block" id="sign-up-link">
                  <Link
                    href={
                      !isLocalAccountRegistrationEnabled
                        ? '#'
                        : '/login#register'
                    }
                    className={`btn me-2 ${!isLocalAccountRegistrationEnabled ? 'opacity-25' : ''}`}
                    style={{
                      pointerEvents: !isLocalAccountRegistrationEnabled
                        ? 'none'
                        : undefined,
                    }}
                    prefetch={false}
                  >
                    <span className="material-symbols-outlined me-1">
                      person_add
                    </span>
                    {t('Sign up')}
                  </Link>
                </span>
                {!isLocalAccountRegistrationEnabled && (
                  <UncontrolledTooltip target="sign-up-link" fade={false}>
                    {t('tooltip.login_required')}
                  </UncontrolledTooltip>
                )}
              </span>
              <Link
                href="/login#login"
                className="btn btn-primary"
                prefetch={false}
              >
                <span className="material-symbols-outlined me-1">login</span>
                {t('Sign in')}
              </Link>
            </div>
          )}
        </nav>
      </Sticky>

      {path != null && currentUser != null && !isReadOnlyUser && (
        <CreateTemplateModalLazyLoaded
          path={path}
          isOpen={isPageTemplateModalShown}
          onClose={() => setIsPageTempleteModalShown(false)}
        />
      )}

      {path != null && (
        <ReconcileTriggerModal
          isOpen={isReconcileModalOpen}
          onClose={() => setIsReconcileModalOpen(false)}
          apiEndpoint="/vault/page/reconcile"
          defaultTargetPath={path}
        />
      )}
    </>
  );
};

export default GrowiContextualSubNavigation;
