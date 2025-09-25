import React, { type JSX, useMemo } from 'react';

import { useSWRxRefs } from '../stores/refs';

import { AttachmentList } from './AttachmentList';
import { RefsContext } from './util/refs-context';

export type Props = {
  pagePath: string;
  prefix?: string;
  depth?: string;
  regexp?: string;
  width?: string;
  height?: string;
  maxWidth?: string;
  maxHeight?: string;
  display?: string;
  grid?: string;
  gridGap?: string;
  noCarousel?: string;

  isImmutable?: boolean;
};

export const RefsImgSubstance = React.memo(
  ({
    pagePath,
    prefix,
    depth,
    regexp,
    width,
    height,
    maxWidth,
    maxHeight,
    display,
    grid,
    gridGap,
    noCarousel,

    isImmutable,
  }: Props): JSX.Element => {
    const refsContext = useMemo(() => {
      const options = {
        pagePath,
        prefix,
        depth,
        regexp,
        width,
        height,
        maxWidth,
        maxHeight,
        display,
        grid,
        gridGap,
        noCarousel,
      };
      return new RefsContext('refsimg', pagePath, options);
    }, [
      pagePath,
      prefix,
      depth,
      regexp,
      width,
      height,
      maxWidth,
      maxHeight,
      display,
      grid,
      gridGap,
      noCarousel,
    ]);

    const {
      data,
      error: axiosError,
      isLoading,
    } = useSWRxRefs(
      pagePath,
      prefix,
      {
        depth,
        regexp,
        width,
        height,
        maxWidth,
        maxHeight,
        display,
        grid,
        gridGap,
        noCarousel,
      },
      isImmutable,
    );
    const attachments = data != null ? data : [];

    const error =
      axiosError != null
        ? new Error(axiosError.response?.data ?? axiosError.message)
        : undefined;

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

export const RefsImg = React.memo((props: Props): JSX.Element => {
  return <RefsImgSubstance {...props} />;
});

export const RefsImgImmutable = React.memo(
  (props: Omit<Props, 'isImmutable'>): JSX.Element => {
    return <RefsImgSubstance {...props} isImmutable />;
  },
);

RefsImg.displayName = 'RefsImg';
