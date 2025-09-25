import type { CSSProperties, JSX } from 'react';
import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';

import type EventEmitter from 'events';
import nodePath from 'path';

import { Origin } from '@growi/core';
import type { IPageHasId } from '@growi/core/dist/interfaces';
import { pathUtils } from '@growi/core/dist/utils';
import { GlobalCodeMirrorEditorKey } from '@growi/editor';
import { CodeMirrorEditorMain } from '@growi/editor/dist/client/components/CodeMirrorEditorMain';
import { useCodeMirrorEditorIsolated } from '@growi/editor/dist/client/stores/codemirror-editor';
import { useResolvedThemeForEditor } from '@growi/editor/dist/client/stores/use-resolved-theme';
import { useRect } from '@growi/ui/dist/utils';
import detectIndent from 'detect-indent';
import { useTranslation } from 'next-i18next';
import { throttle, debounce } from 'throttle-debounce';

import { useUpdateStateAfterSave } from '~/client/services/page-operation';
import { useUpdatePage, extractRemoteRevisionDataFromErrorObj } from '~/client/services/update-page';
import { uploadAttachments } from '~/client/services/upload-attachments';
import { toastError, toastSuccess, toastWarning } from '~/client/util/toastr';
import { useShouldExpandContent } from '~/services/layout/use-should-expand-content';
import {
  useDefaultIndentSize, useCurrentUser,
  useCurrentPathname, useIsEnabledAttachTitleHeader,
  useIsEditable, useIsIndentSizeForced,
  useAcceptedUploadFileType, useIsEnableUnifiedMergeView,
} from '~/stores-universal/context';
import { EditorMode, useEditorMode } from '~/stores-universal/ui';
import { useNextThemes } from '~/stores-universal/use-next-themes';
import {
  useReservedNextCaretLine,
  useEditorSettings,
  useCurrentIndentSize,
  useEditingMarkdown,
  useWaitingSaveProcessing,
} from '~/stores/editor';
import {
  useCurrentPagePath, useSWRxCurrentPage, useCurrentPageId, useIsNotFound, useTemplateBodyData, useSWRxCurrentGrantData,
} from '~/stores/page';
import { mutatePageTree, mutateRecentlyUpdated } from '~/stores/page-listing';
import { usePreviewOptions } from '~/stores/renderer';
import { useIsUntitledPage, useSelectedGrant } from '~/stores/ui';
import { useEditingClients } from '~/stores/use-editing-clients';
import loggerFactory from '~/utils/logger';

import { EditorNavbar } from './EditorNavbar';
import { EditorNavbarBottom } from './EditorNavbarBottom';
import Preview from './Preview';
import { useScrollSync } from './ScrollSyncHelper';
import { useConflictResolver, useConflictEffect, type ConflictHandler } from './conflict';

import '@growi/editor/dist/style.css';


const logger = loggerFactory('growi:PageEditor');


declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}

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

  const { data: isNotFound } = useIsNotFound();
  const { data: pageId } = useCurrentPageId();
  const { data: currentPagePath } = useCurrentPagePath();
  const { data: currentPathname } = useCurrentPathname();
  const { data: currentPage } = useSWRxCurrentPage();
  const { data: selectedGrant } = useSelectedGrant();
  const { data: editingMarkdown } = useEditingMarkdown();
  const { data: isEnabledAttachTitleHeader } = useIsEnabledAttachTitleHeader();
  const { data: templateBodyData } = useTemplateBodyData();
  const { data: isEditable } = useIsEditable();
  const { mutate: mutateWaitingSaveProcessing } = useWaitingSaveProcessing();
  const { data: editorMode, mutate: mutateEditorMode } = useEditorMode();
  const { data: isUntitledPage } = useIsUntitledPage();
  const { data: isIndentSizeForced } = useIsIndentSizeForced();
  const { data: currentIndentSize, mutate: mutateCurrentIndentSize } = useCurrentIndentSize();
  const { data: defaultIndentSize } = useDefaultIndentSize();
  const { data: acceptedUploadFileType } = useAcceptedUploadFileType();
  const { data: editorSettings } = useEditorSettings();
  const { mutate: mutateIsGrantNormalized } = useSWRxCurrentGrantData(currentPage?._id);
  const { data: user } = useCurrentUser();
  const { mutate: mutateEditingUsers } = useEditingClients();
  const onConflict = useConflictResolver();
  const { data: reservedNextCaretLine, mutate: mutateReservedNextCaretLine } = useReservedNextCaretLine();
  const { data: isEnableUnifiedMergeView } = useIsEnableUnifiedMergeView();

  const { data: rendererOptions } = usePreviewOptions();

  const { mutate: mutateResolvedTheme } = useResolvedThemeForEditor();

  const shouldExpandContent = useShouldExpandContent(currentPage);

  const updatePage = useUpdatePage();
  const updateStateAfterSave = useUpdateStateAfterSave(pageId, { supressEditingMarkdownMutation: true });

  useConflictEffect();

  const { resolvedTheme } = useNextThemes();
  mutateResolvedTheme({ themeData: resolvedTheme });

  const currentRevisionId = currentPage?.revision?._id;
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
    if (templateBodyData != null) {
      initialValue += `${templateBodyData}\n`;
    }

    return initialValue;

  }, [isNotFound, currentPathname, editingMarkdown, isEnabledAttachTitleHeader, templateBodyData]);

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

  const save: Save = useCallback(async(revisionId, markdown, opts, onConflict) => {
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

  const saveAndReturnToViewHandler = useCallback(async(opts: SaveOptions) => {
    const markdown = codeMirrorEditor?.getDocString();
    const revisionId = isRevisionIdRequiredForPageUpdate ? currentRevisionId : undefined;
    const page = await save(revisionId, markdown, opts, onConflict);
    if (page == null) {
      return;
    }

    mutateEditorMode(EditorMode.View);
    updateStateAfterSave?.();
  }, [codeMirrorEditor, currentRevisionId, isRevisionIdRequiredForPageUpdate, mutateEditorMode, onConflict, save, updateStateAfterSave]);

  const saveWithShortcut = useCallback(async() => {
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


  const cmProps = useMemo(() => ({
    onChange: (value: string) => {
      setMarkdownPreviewWithDebounce(value);
    },
  }), [setMarkdownPreviewWithDebounce]);


  // set handler to save and return to View
  useEffect(() => {
    globalEmitter.on('saveAndReturnToView', saveAndReturnToViewHandler);

    return function cleanup() {
      globalEmitter.removeListener('saveAndReturnToView', saveAndReturnToViewHandler);
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
      mutateReservedNextCaretLine(0);
    }
  }, [editorMode, mutateReservedNextCaretLine]);


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
          onEditorsUpdated={mutateEditingUsers}
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
