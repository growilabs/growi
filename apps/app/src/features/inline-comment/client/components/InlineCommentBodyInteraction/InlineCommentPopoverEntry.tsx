/**
 * One displayed comment inside `InlineCommentPreviewPopover` — used for the
 * origin comment and for every reply alike.
 *
 * The popover deliberately does not render its entries through the shared
 * `CommentCard`: the mockup draws every entry flat on the popover's own
 * surface, while `CommentCard` brings the shared comment box (a gray fill, a
 * speech-bubble triangle, its own small avatar). The bottom-of-page list keeps
 * using `CommentCard`; only the popover is flat.
 *
 * Origin and reply differ solely in what the caller passes: the origin adds
 * the quote block (`beforeBody`) and the resolve/close controls
 * (`headerExtra`), and each uses its own `testIdPrefix`. Everything else —
 * edit mode, the delete confirmation, and the author-only/read-only-user
 * gating around both — is identical, which is the point of sharing this
 * component.
 *
 * `isEditing` / `isDeleteConfirmOpen` are local to each instance, so one
 * entry being edited leaves every sibling (and the reply form) displayed as
 * usual. That is what fixes the popover's earlier behavior of hiding the whole
 * reply thread whenever the origin comment was edited.
 */
import { type JSX, type ReactNode, useState } from 'react';
import type { IUserHasId } from '@growi/core';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';
import { UserPicture } from '@growi/ui/dist/components';
import { useTranslation } from 'react-i18next';

import { FormattedDistanceDate } from '~/client/components/FormattedDistanceDate';
import { NotAvailableIfReadOnlyUserNotAllowedToComment } from '~/client/components/NotAvailableForReadOnlyUser';
import { DeleteConfirmAlert } from '~/client/components/PageComment/DeleteConfirmAlert';
import RevisionRenderer from '~/components/PageView/RevisionRenderer';
import { Username } from '~/components/User/Username';
import type { RendererOptions } from '~/interfaces/renderer-options';

import { MentionPickerButton } from '../InlineCommentForm/MentionPickerButton';
import { MentionAwareCommentInput } from '../MentionAwareCommentInput/MentionAwareCommentInput';
import { useCommentInputControls } from '../MentionAwareCommentInput/use-comment-input-controls';

import styles from './InlineCommentPreviewPopover.module.scss';

type InlineCommentPopoverEntryProps = {
  id: string;
  /** `null` when the creator relation could not be resolved, as both comment DTOs allow. */
  creator: IUserSerializedSecurely<IUserHasId> | null;
  /**
   * Declared as Date by the DTO but actually arrives as an ISO string over
   * the wire. Forwarded to `FormattedDistanceDate` as-is, exactly as
   * `CommentCard` does; this component never parses it.
   */
  createdAt: Date | string;
  commentText: string;
  /** Undefined while the caller's renderer options load; the body falls back to plain text. */
  rendererOptions: RendererOptions | undefined;
  /** Whether the viewer authored this entry; gates the edit/delete affordances. */
  isOwn: boolean;
  /** Combined with `id` into this entry's own editor key, so two open editors never share one CodeMirror instance. */
  editorKeyPrefix: string;
  onUpdate: (text: string) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  /** Rendered between the header row and the body — the quote block, origin only. */
  beforeBody?: ReactNode;
  /** Appended to the header row's right-hand control group — the resolve toggle and close button, origin only. */
  headerExtra?: ReactNode;
  testIdPrefix: string;
};

export const InlineCommentPopoverEntry = (
  props: InlineCommentPopoverEntryProps,
): JSX.Element => {
  const {
    id,
    creator,
    createdAt,
    commentText,
    rendererOptions,
    isOwn,
    editorKeyPrefix,
    onUpdate,
    onRemove,
    beforeBody,
    headerExtra,
    testIdPrefix,
  } = props;

  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  const { canSubmit, submit, insertMention, onControlsChange } =
    useCommentInputControls();

  const handleEditSubmit = async (text: string): Promise<void> => {
    try {
      await onUpdate(text);
      setEditError(undefined);
      setIsEditing(false);
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when updating the comment',
      );
      // Rethrown so MentionAwareCommentInput keeps the edited text on screen instead of clearing it.
      throw err;
    }
  };

  const handleEditCancel = (): void => {
    setIsEditing(false);
    setEditError(undefined);
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    try {
      await onRemove();
      setDeleteError(undefined);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'An unknown error occurred when deleting the comment',
      );
    } finally {
      setIsDeleteConfirmOpen(false);
    }
  };

  return (
    <>
      <div
        data-testid={`${testIdPrefix}-header`}
        className="d-flex align-items-center gap-2"
      >
        <span
          className={styles['inline-comment-preview-popover-author-picture']}
        >
          <UserPicture user={creator} />
        </span>
        <span className="small fw-semibold">
          {/* `Username`'s prop type excludes null but treats
              null/undefined/unpopulated alike at runtime, so the same
              normalization `CommentCard` does applies here. */}
          <Username user={creator ?? undefined} />
        </span>
        <span className="small text-body-secondary">
          {/* Plain muted text, not `CommentCard`'s anchor link to `#{id}`: an
              inline comment has no element with that id to jump to, and the
              mockup draws the timestamp as text. */}
          <FormattedDistanceDate id={id} date={createdAt} />
        </span>
        <span className="ms-auto d-flex align-items-center gap-2">
          {/* The author-only controls come first so `headerExtra`'s close
              button stays the last element of the row. They are hidden while
              this entry is being edited or awaiting delete confirmation --
              that mode has its own buttons -- but `headerExtra` is not, so
              the popover's close button is reachable in every mode. */}
          {isOwn && !isEditing && !isDeleteConfirmOpen && (
            <NotAvailableIfReadOnlyUserNotAllowedToComment>
              {/* Always visible rather than hover-revealed (unlike the list
                  item's): a popover is on screen only briefly, so a control
                  that has to be discovered by hovering would be easy to miss.
                  `CommentControl.tsx`'s glyphs and button classes are kept
                  (Requirement 3.5), with no `rounded-circle` -- every icon
                  button here is a 32px square. */}
              <span className="d-flex align-items-center gap-1">
                <button
                  type="button"
                  data-testid={`${testIdPrefix}-edit-button`}
                  className={`btn btn-link ${styles['inline-comment-preview-popover-icon-button']}`}
                  aria-label={t('Edit')}
                  onClick={() => setIsEditing(true)}
                >
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button
                  type="button"
                  data-testid={`${testIdPrefix}-delete-button`}
                  className={`btn btn-link text-danger ${styles['inline-comment-preview-popover-icon-button']}`}
                  aria-label={t('Delete')}
                  onClick={() => setIsDeleteConfirmOpen(true)}
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </span>
            </NotAvailableIfReadOnlyUserNotAllowedToComment>
          )}
          {headerExtra}
        </span>
      </div>

      {beforeBody}

      {isEditing ? (
        // Accent-colored border marks the edit-mode input, echoing the
        // primary-accent color already used by the send button in this
        // popover (Requirement 2.2, 3.1: semantic Bootstrap utility classes
        // only, no hardcoded hex).
        <div
          data-testid={`${testIdPrefix}-edit-form`}
          className="border border-primary rounded p-2"
        >
          <MentionAwareCommentInput
            editorKey={`${editorKeyPrefix}_${id}`}
            initialValue={commentText}
            onSubmit={handleEditSubmit}
            onControlsChange={onControlsChange}
          />
          {/* Cancel and Save below the input, right-aligned, in the order the
              delete confirmation elsewhere already uses (Requirement 2.2).
              Save is rendered here, not by MentionAwareCommentInput: that
              component reports its submit control outward so each caller
              places it, which is what lets it sit beside Cancel. Same
              composition as the list item's edit mode. */}
          <div className="d-flex align-items-center justify-content-end gap-2 mt-1">
            <span className="me-auto">
              <MentionPickerButton onInsert={insertMention} />
            </span>
            <button
              type="button"
              data-testid={`${testIdPrefix}-edit-cancel-button`}
              className="btn btn-sm btn-outline-secondary"
              onClick={handleEditCancel}
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              data-testid={`${testIdPrefix}-edit-save-button`}
              className="btn btn-sm btn-primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              {t('Update')}
            </button>
          </div>
        </div>
      ) : (
        <div data-testid={`${testIdPrefix}-body`}>
          {rendererOptions != null ? (
            <RevisionRenderer
              rendererOptions={rendererOptions}
              markdown={commentText}
              additionalClassName="comment"
            />
          ) : (
            <span>{commentText}</span>
          )}
        </div>
      )}

      {editError != null && (
        <span
          className="text-danger d-block"
          data-testid={`${testIdPrefix}-edit-error`}
        >
          {editError}
        </span>
      )}
      {deleteError != null && (
        <span
          className="text-danger d-block"
          data-testid={`${testIdPrefix}-delete-error`}
        >
          {deleteError}
        </span>
      )}
      {isDeleteConfirmOpen && (
        <DeleteConfirmAlert
          testIdPrefix={testIdPrefix}
          onCancel={() => setIsDeleteConfirmOpen(false)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </>
  );
};
