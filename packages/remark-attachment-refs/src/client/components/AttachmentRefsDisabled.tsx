import React, { type JSX } from 'react';

type Props = {
  /** The directive name to show in the message (e.g. 'ref', 'refs', 'gallery') */
  name: string;
};

/**
 * Placeholder rendered in place of a ref/refs directive on a share link page.
 *
 * Attachment ref directives fetch from `/_api/attachment-refs/*`, which is not
 * accessible to anonymous share-link viewers. Rendering this instead of the
 * substance avoids issuing those unauthenticated requests (see issue #11263).
 */
export const AttachmentRefsDisabled = React.memo(
  ({ name }: Props): JSX.Element => {
    return (
      <div className="text-muted">
        <span
          className="material-symbols-outlined fs-5 me-1"
          aria-hidden="true"
        >
          info
        </span>
        <small>{name} is not available on the share link page</small>
      </div>
    );
  },
);
AttachmentRefsDisabled.displayName = 'AttachmentRefsDisabled';
