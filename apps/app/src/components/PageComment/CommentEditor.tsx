import React, {
  useCallback, useState, useRef, useEffect,
} from 'react';

import {
  CodeMirrorEditorComment, GlobalCodeMirrorEditorKey, useCodeMirrorEditorIsolated, useResolvedThemeForEditor,
} from '@growi/editor';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import {
  TabContent, TabPane,
} from 'reactstrap';

import { uploadAttachments } from '~/client/services/upload-attachments';
import { toastError } from '~/client/util/toastr';
import type { IEditorMethods } from '~/interfaces/editor-methods';
import { useSWRxPageComment, useSWRxEditingCommentsNum } from '~/stores/comment';
import {
  useCurrentUser, useIsSlackConfigured, useAcceptedUploadFileType,
} from '~/stores/context';
import {
  useSWRxSlackChannels, useIsSlackEnabled, useIsEnabledUnsavedWarning, useEditorSettings,
} from '~/stores/editor';
import { useCurrentPagePath } from '~/stores/page';
import { useNextThemes } from '~/stores/use-next-themes';
import loggerFactory from '~/utils/logger';

import { NotAvailableForGuest } from '../NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from '../NotAvailableForReadOnlyUser';

import { CommentPreview } from './CommentPreview';
import { SwitchingButtonGroup } from './SwitchingButtonGroup';


import '@growi/editor/dist/style.css';
import styles from './CommentEditor.module.scss';


const logger = loggerFactory('growi:components:CommentEditor');


const SlackNotification = dynamic(() => import('../SlackNotification').then(mod => mod.SlackNotification), { ssr: false });

export type CommentEditorProps = {
  pageId: string,
  isForNewComment?: boolean,
  replyTo?: string,
  revisionId: string,
  currentCommentId?: string,
  commentBody?: string,
  onCancelButtonClicked?: () => void,
  onCommentButtonClicked?: () => void,
}


export const CommentEditor = (props: CommentEditorProps): JSX.Element => {

  const {
    pageId, isForNewComment, replyTo, revisionId,
    currentCommentId, commentBody, onCancelButtonClicked, onCommentButtonClicked,
  } = props;

  const { data: currentUser } = useCurrentUser();
  const { data: currentPagePath } = useCurrentPagePath();
  const { update: updateComment, post: postComment } = useSWRxPageComment(pageId);
  const { data: isSlackEnabled, mutate: mutateIsSlackEnabled } = useIsSlackEnabled();
  const { data: acceptedUploadFileType } = useAcceptedUploadFileType();
  const { data: slackChannelsData } = useSWRxSlackChannels(currentPagePath);
  const { data: isSlackConfigured } = useIsSlackConfigured();
  const { data: editorSettings } = useEditorSettings();
  const { mutate: mutateIsEnabledUnsavedWarning } = useIsEnabledUnsavedWarning();
  const {
    increment: incrementEditingCommentsNum,
    decrement: decrementEditingCommentsNum,
  } = useSWRxEditingCommentsNum();
  const { mutate: mutateResolvedTheme } = useResolvedThemeForEditor();
  const { data: codeMirrorEditor } = useCodeMirrorEditorIsolated(GlobalCodeMirrorEditorKey.COMMENT);
  const { resolvedTheme } = useNextThemes();
  mutateResolvedTheme({ themeData: resolvedTheme });

  const [isReadyToUse, setIsReadyToUse] = useState(!isForNewComment);
  const [comment, setComment] = useState(commentBody ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState();
  const [slackChannels, setSlackChannels] = useState<string>('');
  const [incremented, setIncremented] = useState(false);

  const { t } = useTranslation('');

  const editorRef = useRef<IEditorMethods>(null);

  const router = useRouter();

  // UnControlled CodeMirror value is not reset on page transition, so explicitly set the value to the initial value
  const onRouterChangeComplete = useCallback(() => {
    editorRef.current?.setValue('');
  }, []);

  useEffect(() => {
    router.events.on('routeChangeComplete', onRouterChangeComplete);
    return () => {
      router.events.off('routeChangeComplete', onRouterChangeComplete);
    };
  }, [onRouterChangeComplete, router.events]);

  const handleSelect = useCallback((showPreview: boolean) => {
    setShowPreview(showPreview);
  }, []);

  // DO NOT dependent on slackChannelsData directly: https://github.com/weseek/growi/pull/7332
  const slackChannelsDataString = slackChannelsData?.toString();
  const initializeSlackEnabled = useCallback(() => {
    setSlackChannels(slackChannelsDataString ?? '');
    mutateIsSlackEnabled(false);
  }, [mutateIsSlackEnabled, slackChannelsDataString]);

  useEffect(() => {
    initializeSlackEnabled();
  }, [initializeSlackEnabled]);

  const isSlackEnabledToggleHandler = (isSlackEnabled: boolean) => {
    mutateIsSlackEnabled(isSlackEnabled, false);
  };

  const slackChannelsChangedHandler = useCallback((slackChannels: string) => {
    setSlackChannels(slackChannels);
  }, []);

  const initializeEditor = useCallback(async() => {
    const editingCommentsNum = comment !== '' ? await decrementEditingCommentsNum() : undefined;

    setComment('');
    setShowPreview(false);
    setError(undefined);
    initializeSlackEnabled();
    // reset value
    if (editorRef.current == null) { return }
    editorRef.current.setValue('');

    if (editingCommentsNum != null && editingCommentsNum === 0) {
      mutateIsEnabledUnsavedWarning(false); // must be after clearing comment or else onChange will override bool
    }

  }, [initializeSlackEnabled, comment, decrementEditingCommentsNum, mutateIsEnabledUnsavedWarning]);

  const cancelButtonClickedHandler = useCallback(() => {
    // change state to not ready
    // when this editor is for the new comment mode
    if (isForNewComment) {
      setIsReadyToUse(false);
    }

    initializeEditor();

    if (onCancelButtonClicked != null) {
      onCancelButtonClicked();
    }
  }, [isForNewComment, onCancelButtonClicked, initializeEditor]);

  const postCommentHandler = useCallback(async() => {
    try {
      if (currentCommentId != null) {
        // update current comment
        await updateComment(comment, revisionId, currentCommentId);
      }
      else {
        // post new comment
        const postCommentArgs = {
          commentForm: {
            comment,
            revisionId,
            replyTo,
          },
          slackNotificationForm: {
            isSlackEnabled,
            slackChannels,
          },
        };
        await postComment(postCommentArgs);
      }

      initializeEditor();

      if (onCommentButtonClicked != null) {
        onCommentButtonClicked();
      }

      // Insert empty string as new comment editor is opened after comment
      codeMirrorEditor?.initDoc('');
    }
    catch (err) {
      const errorMessage = err.message || 'An unknown error occured when posting comment';
      setError(errorMessage);
    }
  }, [
    currentCommentId, initializeEditor, onCommentButtonClicked, codeMirrorEditor,
    updateComment, comment, revisionId, replyTo, isSlackEnabled, slackChannels, postComment,
  ]);

  // the upload event handler
  const uploadHandler = useCallback((files: File[]) => {
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

  const getCommentHtml = useCallback(() => {
    if (currentPagePath == null) {
      return <></>;
    }

    return <CommentPreview markdown={comment} />;
  }, [currentPagePath, comment]);

  const renderBeforeReady = useCallback((): JSX.Element => {
    return (
      <div>
        <NotAvailableForGuest>
          <NotAvailableForReadOnlyUser>
            <button
              type="button"
              className="btn btn-outline-primary w-100 text-start py-3"
              onClick={() => setIsReadyToUse(true)}
              data-testid="open-comment-editor-button"
            >
              <UserPicture user={currentUser} noLink noTooltip additionalClassName="me-3" />
              <span className="material-symbols-outlined me-1 fs-5">add_comment</span>
              <small>Add Comment in markdown...</small>
            </button>
          </NotAvailableForReadOnlyUser>
        </NotAvailableForGuest>
      </div>
    );
  }, [currentUser]);

  // const onChangeHandler = useCallback((newValue: string, isClean: boolean) => {
  //   setComment(newValue);
  //   if (!isClean && !incremented) {
  //     incrementEditingCommentsNum();
  //     setIncremented(true);
  //   }
  //   mutateIsEnabledUnsavedWarning(!isClean);
  // }, [mutateIsEnabledUnsavedWarning, incrementEditingCommentsNum, incremented]);

  const onChangeHandler = useCallback((newValue: string) => {
    setComment(newValue);

    if (!incremented) {
      incrementEditingCommentsNum();
      setIncremented(true);
    }
  }, [incrementEditingCommentsNum, incremented]);

  // initialize CodeMirrorEditor
  useEffect(() => {
    if (commentBody == null) {
      return;
    }
    codeMirrorEditor?.initDoc(commentBody);
  }, [codeMirrorEditor, commentBody]);


  const renderReady = () => {
    const commentPreview = getCommentHtml();

    const errorMessage = <span className="text-danger text-end me-2">{error}</span>;
    const cancelButton = (
      <button
        type="button"
        className="btn btn-outline-neutral-secondary"
        onClick={cancelButtonClickedHandler}
      >
        {t('Cancel')}
      </button>
    );
    const submitButton = (
      <button
        type="button"
        data-testid="comment-submit-button"
        className="btn btn-primary"
        onClick={postCommentHandler}
      >
        {t('page_comment.comment')}
      </button>
    );

    return (
      <>
        <div className="px-4 pt-3 pb-1">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="d-flex">
              <UserPicture user={currentUser} noLink noTooltip />
              <p className="ms-2 mb-0">Add a comment</p>
            </div>
            <SwitchingButtonGroup showPreview={showPreview} onSelected={handleSelect} />
          </div>
          <TabContent activeTab={showPreview ? 'comment_preview' : 'comment_editor'}>
            <TabPane tabId="comment_editor">
              <CodeMirrorEditorComment
                acceptedUploadFileType={acceptedUploadFileType}
                onChange={onChangeHandler}
                onSave={postCommentHandler}
                onUpload={uploadHandler}
                editorSettings={editorSettings}
              />
            </TabPane>
            <TabPane tabId="comment_preview">
              <div className="comment-preview-container">
                {commentPreview}
              </div>
            </TabPane>
          </TabContent>
        </div>

        <div className="comment-submit px-4 pb-3 mb-2">
          <div className="d-flex">
            <span className="flex-grow-1" />
            <span className="d-none d-sm-inline">{errorMessage && errorMessage}</span>

            {isSlackConfigured && isSlackEnabled != null
              && (
                <div className="align-self-center me-md-3">
                  <SlackNotification
                    isSlackEnabled={isSlackEnabled}
                    slackChannels={slackChannels}
                    onEnabledFlagChange={isSlackEnabledToggleHandler}
                    onChannelChange={slackChannelsChangedHandler}
                    id="idForComment"
                  />
                </div>
              )
            }
            <div className="d-none d-sm-block">
              <span className="me-2">{cancelButton}</span><span>{submitButton}</span>
            </div>
          </div>
          <div className="d-block d-sm-none mt-2">
            <div className="d-flex justify-content-end">
              {error && errorMessage}
              <span className="me-2">{cancelButton}</span><span>{submitButton}</span>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className={`${styles['comment-editor-styles']} form page-comment-form`}>
      <div className="comment-form">
        <div className="comment-form-main bg-comment rounded">
          {isReadyToUse
            ? renderReady()
            : renderBeforeReady()
          }
        </div>
      </div>
    </div>
  );

};
