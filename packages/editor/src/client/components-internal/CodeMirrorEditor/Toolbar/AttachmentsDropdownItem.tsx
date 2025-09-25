import type { ReactNode, JSX } from 'react';

import type { AcceptedUploadFileType } from '@growi/core';
import {
  DropdownItem,
} from 'reactstrap';

import { useFileDropzone } from '../../../services-internal';

type Props = {
  acceptedUploadFileType: AcceptedUploadFileType,
  children?: ReactNode,
  onUpload?: (files: File[]) => void,
  onClose?: () => void,
}

export const AttachmentsDropdownItem = (props: Props): JSX.Element => {

  const {
    acceptedUploadFileType,
    children,
    onUpload,
    onClose,
  } = props;

  const {
    getRootProps,
    getInputProps,
    open,
  } = useFileDropzone({
    // close after uploading
    // https://github.com/growilabs/growi/pull/8564
    onUpload: (files: File[]) => { onUpload?.(files); onClose?.() },
    acceptedUploadFileType,
    dropzoneOpts: {
      noClick: true,
      noDrag: true,
      noKeyboard: true,
      // close after cancelling
      // https://github.com/growilabs/growi/pull/8564
      onFileDialogCancel: onClose,
    },
  });

  return (
    <div {...getRootProps()} className="dropzone">
      <input {...getInputProps()} />
      <DropdownItem toggle={false} className="d-flex gap-2 align-items-center" onClick={open}>
        {children}
      </DropdownItem>
    </div>
  );
};
