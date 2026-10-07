import { useCallback, useState } from 'react';
import { AcceptedUploadFileType } from '@growi/core';
import type { Accept, DropzoneOptions, DropzoneState } from 'react-dropzone';
import { useDropzone } from 'react-dropzone';

type FileDropzoneState = DropzoneState & {
  isUploading: boolean;
};

type Props = {
  acceptedUploadFileType: AcceptedUploadFileType;
  dropzoneOpts?: DropzoneOptions;
  onUpload?: (files: File[]) => void;
};

export const useFileDropzone = (props: Props): FileDropzoneState => {
  const { acceptedUploadFileType, dropzoneOpts, onUpload } = props;

  const [isUploading, setIsUploading] = useState(false);

  const dropHandler = useCallback(
    (acceptedFiles: File[]) => {
      if (onUpload == null) {
        return;
      }
      if (acceptedUploadFileType === AcceptedUploadFileType.NONE) {
        return;
      }

      setIsUploading(true);
      onUpload(acceptedFiles);
      setIsUploading(false);
    },
    [onUpload, acceptedUploadFileType],
  );

  const accept: Accept | undefined =
    acceptedUploadFileType === AcceptedUploadFileType.IMAGE
      ? { 'image/*': [] }
      : undefined;

  const dzState = useDropzone({
    onDrop: dropHandler,
    accept,
    ...dropzoneOpts,
  });

  return {
    ...dzState,
    isUploading,
  };
};
