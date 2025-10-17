import React, { type JSX, useMemo } from 'react';

import { useSWRxRef } from '../stores/refs';

import { AttachmentList } from './AttachmentList';
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
  return <RefImgSubstance {...props} />;
});

export const RefImgImmutable = React.memo(
  (props: Omit<Props, 'isImmutable'>): JSX.Element => {
    return <RefImgSubstance {...props} isImmutable />;
  },
);

RefImg.displayName = 'RefImg';
