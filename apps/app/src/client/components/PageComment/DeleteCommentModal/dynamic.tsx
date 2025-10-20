import type { JSX } from 'react';

import { useLazyLoader } from '../../../util/use-lazy-loader';

import type { DeleteCommentModalProps } from './DeleteCommentModal';

export const DeleteCommentModalLazyLoaded = (props: DeleteCommentModalProps): JSX.Element => {
  const DeleteCommentModal = useLazyLoader<DeleteCommentModalProps>(
    'delete-comment-modal',
    () => import('./DeleteCommentModal').then(mod => ({ default: mod.DeleteCommentModal })),
    props.isShown,
  );

  return DeleteCommentModal != null ? <DeleteCommentModal {...props} /> : <></>;
};
