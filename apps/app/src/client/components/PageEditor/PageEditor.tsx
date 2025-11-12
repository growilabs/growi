import type { CSSProperties, JSX } from 'react';
import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';

import nodePath from 'path';

import { Origin } from '@growi/core';
import type { IPageHasId } from '@growi/core/dist/interfaces';
import { pathUtils, globalEventTarget } from '@growi/core/dist/utils';
import { GlobalCodeMirrorEditorKey, useSetResolvedTheme } from '@growi/editor';
import { CodeMirrorEditorMain } from '@growi/editor/dist/client/components/CodeMirrorEditorMain';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { useRect } from '@growi/ui/dist/utils';
import detectIndent from 'detect-indent';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'next-i18next';
import { throttle, debounce } from 'throttle-debounce';

import { useUpdateStateAfterSave } from '~/client/services/page-operation';
import { useUpdatePage, extractRemoteRevisionDataFromErrorObj } from '~/client/services/update-page';
import { uploadAttachments } from '~/client/services/upload-attachments';
import { toastError, toastSuccess, toastWarning } from '~/client/util/toastr';
import { useIsEnableUnifiedMergeView } from '~/features/openai/client/states';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content';
import { useCurrentPathname, useCurrentUser } from '~/states/global';
import {
  useIsEditable,
  useCurrentPagePath,
  useCurrentPageData,
  useCurrentPageId,
  usePageNotFound,
  useIsUntitledPage,
} from '~/states/page';
import { useTemplateBody } from '~/states/page/hooks';
import {
  defaultIndentSizeAtom,
  isEnabledAttachTitleHeaderAtom,
  isIndentSizeForcedAtom,
  useAcceptedUploadFileType,
} from '~/states/server-configurations';
import {
  useCurrentIndentSize, useCurrentIndentSizeActions,
  useEditorMode, EditorMode, useEditingMarkdown, useSelectedGrant,
  useWaitingSaveProcessingActions, useSetReservedNextCaretLine, useReservedNextCaretLineValue,
} from '~/states/ui/editor';
import { useSetEditingClients } from '~/states/ui/editor/editing-clients';
import { useNextThemes } from '~/stores-universal/use-next-themes';
import { useEditorSettings } from '~/stores/editor';
import {
  useSWRxCurrentGrantData,
} from '~/stores/page';
import { mutatePageTree, mutateRecentlyUpdated } from '~/stores/page-listing';
import { usePreviewOptions } from '~/stores/renderer';
import loggerFactory from '~/utils/logger';

import { EditorNavbar } from './EditorNavbar';
import { EditorNavbarBottom } from './EditorNavbarBottom';
import Preview from './Preview';
import { useScrollSync } from './ScrollSyncHelper';
import { useConflictResolver, useConflictEffect, type ConflictHandler } from './conflict';

import '@growi/editor/dist/style.css';

const logger = loggerFactory('growi:PageEditor');


export type SaveOptions = {
  wip: boolean,
  slackChannels: string,
  isSlackEnabled: boolean,
  overwriteScopesOfDescendants?: boolean
}
export type Save = (
  revisionId?: string,
  requestMarkdown?: string,
  opts?: SaveOptions,
  onConflict?: ConflictHandler
) => Promise<IPageHasId | null>

type Props = {
  visibility?: boolean,
}

export const PageEditorSubstance = (props: Props): JSX.Element => {

  const { t } = useTranslation();

  const previewRef = useRef<HTMLDivElement>(null);
  const [previewRect] = useRect(previewRef);

  const isNotFound = usePageNotFound();
  const pageId = useCurrentPageId();
  const currentPagePath = useCurrentPagePath();
  const currentPathname = useCurrentPathname();
  const currentPage = useCurrentPageData();
  const [selectedGrant] = useSelectedGrant();
  const editingMarkdown = useEditingMarkdown();
  const isEnabledAttachTitleHeader = useAtomValue(isEnabledAttachTitleHeaderAtom);
  const templateBody = useTemplateBody();
  const isEditable = useIsEditable();
  const { mutate: mutateWaitingSaveProcessing } = useWaitingSaveProcessingActions();
  const { editorMode, setEditorMode } = useEditorMode();
  const isUntitledPage = useIsUntitledPage();
  const isIndentSizeForced = useAtomValue(isIndentSizeForcedAtom);
  const currentIndentSize = useCurrentIndentSize();
  const { mutate: mutateCurrentIndentSize } = useCurrentIndentSizeActions();
  const defaultIndentSize = useAtomValue(defaultIndentSizeAtom);
  const acceptedUploadFileType = useAcceptedUploadFileType();
  const { data: editorSettings } = useEditorSettings();
  const { mutate: mutateIsGrantNormalized } = useSWRxCurrentGrantData(currentPage?._id);
  const user = useCurrentUser();
  const setEditingClients = useSetEditingClients();
  const onConflict = useConflictResolver();
  const reservedNextCaretLine = useReservedNextCaretLineValue();
  const setReservedNextCaretLine = useSetReservedNextCaretLine();
  const isEnableUnifiedMergeView = useIsEnableUnifiedMergeView();

  const { data: rendererOptions } = usePreviewOptions();

  const shouldExpandContent = useShouldExpandContent(currentPage);

  const updatePage = useUpdatePage();
  const updateStateAfterSave = useUpdateStateAfterSave(pageId, { supressEditingMarkdownMutation: true });

  useConflictEffect();

  const setResolvedTheme = useSetResolvedTheme();
  const { resolvedTheme } = useNextThemes();
  useEffect(() => {
    setResolvedTheme(resolvedTheme);
  }, [resolvedTheme, setResolvedTheme]);

  const currentRevisionId = currentPage?.revision?._id;

  // There are cases where "revisionId" is not required for revision updates
  // See: https://dev.growi.org/651a6f4a008fee2f99187431#origin-%E3%81%AE%E5%BC%B7%E5%BC%B1
  const isRevisionIdRequiredForPageUpdate = currentPage?.revision?.origin === undefined;

  const initialValueRef = useRef('');
  const initialValue = useMemo(() => {
    if (!isNotFound) {
      return editingMarkdown ?? '';
    }

    let initialValue = '';
    if (isEnabledAttachTitleHeader && currentPathname != null) {
      const pageTitle = nodePath.basename(currentPathname);
      initialValue += `${pathUtils.attachTitleHeader(pageTitle)}\n`;
    }
    if (templateBody != null) {
      initialValue += `${templateBody}\n`;
    }

    return initialValue;

  }, [isNotFound, currentPathname, editingMarkdown, isEnabledAttachTitleHeader, templateBody]);

  useEffect(() => {
    // set to ref
    initialValueRef.current = initialValue;
  }, [initialValue]);

  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.MAIN);

  const [markdownToPreview, setMarkdownToPreview] = useState<string>(codeMirrorEditor?.getDocString() ?? '');
  const setMarkdownPreviewWithDebounce = useMemo(() => debounce(100, throttle(150, (value: string) => {
    setMarkdownToPreview(value);
  })), []);


  const { scrollEditorHandler, scrollPreviewHandler } = useScrollSync(GlobalCodeMirrorEditorKey.MAIN, previewRef);

  const scrollEditorHandlerThrottle = useMemo(() => throttle(25, scrollEditorHandler), [scrollEditorHandler]);
  const scrollPreviewHandlerThrottle = useMemo(() => throttle(25, scrollPreviewHandler), [scrollPreviewHandler]);

  const save: Save = useCallback(async (revisionId, markdown, opts, onConflict) => {
    if (pageId == null || selectedGrant == null) {
      logger.error('Some materials to save are invalid', {
        pageId, selectedGrant,
      });
      throw new Error('Some materials to save are invalid');
    }

    try {
      mutateWaitingSaveProcessing(true);

      const { page } = await updatePage({
        pageId,
        revisionId,
        wip: opts?.wip,
        body: markdown ?? '',
        grant: selectedGrant?.grant,
        origin: Origin.Editor,
        userRelatedGrantUserGroupIds: selectedGrant?.userRelatedGrantedGroups,
        ...(opts ?? {}),
      });

      // to sync revision id with page tree: https://github.com/growilabs/growi/pull/7227
      mutatePageTree();

      mutateRecentlyUpdated();
      // sync current grant data after update
      mutateIsGrantNormalized();

      return page;
    }
    catch (error) {
      logger.error('failed to save', error);

      const remoteRevisionData = extractRemoteRevisionDataFromErrorObj(error);
      if (remoteRevisionData != null) {
        onConflict?.(remoteRevisionData, markdown ?? '', save, opts);
        toastWarning(t('modal_resolve_conflict.conflicts_with_new_body_on_server_side'));
        return null;
      }

      toastError(error);
      return null;
    }
    finally {
      mutateWaitingSaveProcessing(false);
    }
  }, [pageId, selectedGrant, mutateWaitingSaveProcessing, updatePage, mutateIsGrantNormalized, t]);

  const saveAndReturnToViewHandler = useCallback(async(evt: CustomEvent<SaveOptions>) => {
    const markdown = codeMirrorEditor?.getDocString();
    const revisionId = isRevisionIdRequiredForPageUpdate ? currentRevisionId : undefined;
    const page = await save(revisionId, markdown, evt.detail, onConflict);
    if (page == null) {
      return;
    }

    setEditorMode(EditorMode.View);
    updateStateAfterSave?.();
  }, [codeMirrorEditor, currentRevisionId, isRevisionIdRequiredForPageUpdate, setEditorMode, onConflict, save, updateStateAfterSave]);

  const saveWithShortcut = useCallback(async () => {
    const markdown = codeMirrorEditor?.getDocString();
    const revisionId = isRevisionIdRequiredForPageUpdate ? currentRevisionId : undefined;
    const page = await save(revisionId, markdown, undefined, onConflict);
    if (page == null) {
      return;
    }

    toastSuccess(t('toaster.save_succeeded'));
    updateStateAfterSave?.();
  }, [codeMirrorEditor, currentRevisionId, isRevisionIdRequiredForPageUpdate, onConflict, save, t, updateStateAfterSave]);


  // the upload event handler
  const uploadHandler = useCallback((files: File[]) => {
    if (pageId == null) {
      logger.error('pageId is invalid', {
        pageId,
      });
      throw new Error('pageId is invalid');
    }

    uploadAttachments(pageId, files, {
      onUploaded: (attachment) => {
        const fileName = attachment.originalName;

        const prefix = attachment.fileFormat.startsWith('image/')
          ? '!' // use "![fileName](url)" syntax when image
          : '';
        const insertText = `${prefix}[${fileName}](${attachment.filePathProxied})\n`;

        codeMirrorEditor?.insertText(insertText);
      },
      onError: (error) => {
        toastError(error);
      },
    });
  }, [codeMirrorEditor, pageId]);

  const onChangeHandler = useCallback((value: string) => {
    setMarkdownPreviewWithDebounce(value);
  }, [setMarkdownPreviewWithDebounce]);

  const cmProps = useMemo(() => ({
    onChange: onChangeHandler,
  }), [onChangeHandler]);


  // set handler to save and return to View
  useEffect(() => {
    globalEventTarget.addEventListener('saveAndReturnToView', saveAndReturnToViewHandler);

    return function cleanup() {
      globalEventTarget.removeEventListener('saveAndReturnToView', saveAndReturnToViewHandler);
    };
  }, [saveAndReturnToViewHandler]);

  // set handler to focus
  useLayoutEffect(() => {
    if (editorMode === EditorMode.Editor && isUntitledPage === false) {
      codeMirrorEditor?.focus();
    }
  }, [codeMirrorEditor, editorMode, isUntitledPage]);

  // Detect indent size from contents (only when users are allowed to change it)
  useEffect(() => {
    // do nothing if the indent size fixed
    if (isIndentSizeForced == null || isIndentSizeForced) {
      mutateCurrentIndentSize(undefined);
      return;
    }

    // detect from markdown
    if (initialValue != null) {
      const detectedIndent = detectIndent(initialValue);
      if (detectedIndent.type === 'space' && new Set([2, 4]).has(detectedIndent.amount)) {
        mutateCurrentIndentSize(detectedIndent.amount);
      }
    }
  }, [initialValue, isIndentSizeForced, mutateCurrentIndentSize]);


  // set caret line if the edit button next to Header is clicked.
  useEffect(() => {
    if (codeMirrorEditor?.setCaretLine == null) {
      return;
    }
    if (editorMode === EditorMode.Editor) {
      codeMirrorEditor.setCaretLine(reservedNextCaretLine ?? 0, true);
    }

  }, [codeMirrorEditor, editorMode, reservedNextCaretLine]);

  // reset caret line if returning to the View.
  useEffect(() => {
    if (editorMode === EditorMode.View) {
      setReservedNextCaretLine(0);
    }
  }, [editorMode, setReservedNextCaretLine]);


  // TODO: Check the reproduction conditions that made this code necessary and confirm reproduction
  // // when transitioning to a different page, if the initialValue is the same,
  // // UnControlled CodeMirror value does not reset, so explicitly set the value to initialValue
  // const onRouterChangeComplete = useCallback(() => {
  //   codeMirrorEditor?.initDoc(ydoc?.getText('codemirror').toString());
  //   codeMirrorEditor?.setCaretLine();
  // }, [codeMirrorEditor, ydoc]);

  // useEffect(() => {
  //   router.events.on('routeChangeComplete', onRouterChangeComplete);
  //   return () => {
  //     router.events.off('routeChangeComplete', onRouterChangeComplete);
  //   };
  // }, [onRouterChangeComplete, router.events]);

  const pastEndStyle: CSSProperties | undefined = useMemo(() => {
    if (previewRect == null) {
      return undefined;
    }

    const previewRectHeight = previewRect.height;

    // containerHeight - 1.5 line height
    return { paddingBottom: `calc(${previewRectHeight}px - 2em)` };
  }, [previewRect]);

  if (!isEditable) {
    return <></>;
  }

  if (rendererOptions == null) {
    return <></>;
  }

  return (
    <div className={`flex-expand-horiz ${props.visibility ? '' : 'd-none'}`}>
      <div className="page-editor-editor-container flex-expand-vert border-end">
        <CodeMirrorEditorMain
          enableUnifiedMergeView={isEnableUnifiedMergeView}
          enableCollaboration={editorMode === EditorMode.Editor}
          onSave={saveWithShortcut}
          onUpload={uploadHandler}
          acceptedUploadFileType={acceptedUploadFileType}
          onScroll={scrollEditorHandlerThrottle}
          indentSize={currentIndentSize ?? defaultIndentSize}
          user={user ?? undefined}
          pageId={pageId ?? undefined}
          editorSettings={editorSettings}
          onEditorsUpdated={setEditingClients}
          cmProps={cmProps}
        />
      </div>
      <div
        ref={previewRef}
        onScroll={scrollPreviewHandlerThrottle}
        className="page-editor-preview-container flex-expand-vert overflow-y-auto d-none d-lg-flex"
      >
        <Preview
          rendererOptions={rendererOptions}
          markdown={markdownToPreview}
          pagePath={currentPagePath}
          expandContentWidth={shouldExpandContent}
          style={pastEndStyle}
        />
      </div>
    </div>
  );
};

export const PageEditor = React.memo((props: Props): JSX.Element => {
  return (
    <div data-testid="page-editor" id="page-editor" className={`flex-expand-vert ${props.visibility ? '' : 'd-none'}`}>

      <EditorNavbar />

      <PageEditorSubstance visibility={props.visibility} />

      <EditorNavbarBottom />

    </div>
  );
});
PageEditor.displayName = 'PageEditor';
