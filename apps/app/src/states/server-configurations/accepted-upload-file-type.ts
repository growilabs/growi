import { AcceptedUploadFileType } from '@growi/core';
import { atom, useAtomValue } from 'jotai';

import {
  isUploadAllFileAllowedAtom,
  isUploadEnabledAtom,
} from './server-configurations';

// Derived atom for accepted upload file type calculation
const acceptedUploadFileTypeAtom = atom((get) => {
  const isUploadEnabled = get(isUploadEnabledAtom);
  const isUploadAllFileAllowed = get(isUploadAllFileAllowedAtom);

  if (!isUploadEnabled) {
    return AcceptedUploadFileType.NONE;
  }

  if (isUploadAllFileAllowed) {
    return AcceptedUploadFileType.ALL;
  }

  return AcceptedUploadFileType.IMAGE;
});

export const useAcceptedUploadFileType = (): AcceptedUploadFileType => {
  return useAtomValue(acceptedUploadFileTypeAtom);
};
