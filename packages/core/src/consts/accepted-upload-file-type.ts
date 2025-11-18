export const AcceptedUploadFileType = {
  ALL: 'all',
  IMAGE: 'image',
  NONE: 'none',
} as const;
export type AcceptedUploadFileType =
  (typeof AcceptedUploadFileType)[keyof typeof AcceptedUploadFileType];
