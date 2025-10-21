import React, { type JSX, useMemo } from 'react';

import { useSWRxRefs } from '../stores/refs';
import { AttachmentList } from './AttachmentList';
import { RefsContext } from './util/refs-context';

type Props = {
  pagePath: string;
  prefix?: string;
  depth?: string;
  regexp?: string;

  isImmutable?: boolean;
};

const RefsSubstance = React.memo(
  ({
    pagePath,
    prefix,
    depth,
    regexp,

    isImmutable,
  }: Props): JSX.Element => {
    const refsContext = useMemo(() => {
      const options = {
        prefix,
        depth,
        regexp,
      };
      return new RefsContext('refs', pagePath, options);
    }, [pagePath, prefix, depth, regexp]);

    const { data, error, isLoading } = useSWRxRefs(
      pagePath,
      prefix,
      { depth, regexp },
      isImmutable,
    );
    const attachments = data != null ? data : [];

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

export const Refs = React.memo((props: Props): JSX.Element => {
  return <RefsSubstance {...props} />;
});

export const RefsImmutable = React.memo(
  (props: Omit<Props, 'isImmutable'>): JSX.Element => {
    return <RefsSubstance {...props} isImmutable />;
  },
);

Refs.displayName = 'Refs';
