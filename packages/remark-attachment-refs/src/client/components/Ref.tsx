import React, { type JSX, useMemo } from 'react';

import { useSWRxRef } from '../stores/refs';
import { AttachmentList } from './AttachmentList';
import { RefsContext } from './util/refs-context';

type Props = {
  fileNameOrId: string;
  pagePath: string;
  isImmutable?: boolean;
};

const RefSubstance = React.memo(
  ({ fileNameOrId, pagePath, isImmutable }: Props): JSX.Element => {
    const refsContext = useMemo(() => {
      return new RefsContext('ref', pagePath, { fileNameOrId });
    }, [fileNameOrId, pagePath]);

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

export const Ref = React.memo((props: Props): JSX.Element => {
  return <RefSubstance {...props} />;
});

export const RefImmutable = React.memo(
  (props: Omit<Props, 'isImmutable'>): JSX.Element => {
    return <RefSubstance {...props} isImmutable />;
  },
);

Ref.displayName = 'Ref';
