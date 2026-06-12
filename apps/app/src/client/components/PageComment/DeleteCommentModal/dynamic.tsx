import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader.js';

import type { DeleteCommentModalProps } from './DeleteCommentModal.js';

export const DeleteCommentModalLazyLoaded = (
  props: DeleteCommentModalProps,
): JSX.Element => {
  const DeleteCommentModal = useLazyLoader<DeleteCommentModalProps>(
    'delete-comment-modal',
    () =>
      import(
        '~/client/components/PageComment/DeleteCommentModal/DeleteCommentModal.js'
      ).then((mod) => ({
        default: mod.DeleteCommentModal,
      })),
    props.isShown,
  );

  return DeleteCommentModal != null ? <DeleteCommentModal {...props} /> : <></>;
};
