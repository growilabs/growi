import React, { type JSX, useMemo } from 'react';

import { useSWRxRef } from '../stores/refs';
import { AttachmentList } from './AttachmentList';
import { AttachmentRefsDisabled } from './AttachmentRefsDisabled';
import { RefsContext } from './util/refs-context';

type Props = {
  fileNameOrId: string;
  pagePath: string;
  width?: string;
  height?: string;
  maxWidth?: string;
  maxHeight?: string;
  alt?: string;

  isImmutable?: boolean;
  isSharedPage?: boolean;
};

const RefImgSubstance = React.memo(
  ({
    fileNameOrId,
    pagePath,
    width,
    height,
    maxWidth,
    maxHeight,
    alt,
    isImmutable,
  }: Props): JSX.Element => {
    const refsContext = useMemo(() => {
      const options = {
        fileNameOrId,
        width,
        height,
        maxWidth,
        maxHeight,
        alt,
      };
      return new RefsContext('refimg', pagePath, options);
    }, [fileNameOrId, pagePath, width, height, maxWidth, maxHeight, alt]);

    const { data, error, isLoading } = useSWRxRef(
      pagePath,
      fileNameOrId,
      isImmutable,
    );
    const attachments = data != null ? [data] : [];

    return (
      <AttachmentList
        refsContext={refsContext}
        isLoading={isLoading}
        error={error}
        attachments={attachments}
      />
    );
  },
);

export const RefImg = React.memo((props: Props): JSX.Element => {
  if (props.isSharedPage) {
    return <AttachmentRefsDisabled name="refimg" />;
  }
  return <RefImgSubstance {...props} />;
});

export const RefImgImmutable = React.memo(
  (props: Omit<Props, 'isImmutable'>): JSX.Element => {
    return <RefImg {...props} isImmutable />;
  },
);

RefImg.displayName = 'RefImg';
