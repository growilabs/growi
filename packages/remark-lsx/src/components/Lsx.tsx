import React, { useCallback, useMemo } from 'react';


import { useSWRxNodeTree } from '../stores/lsx';

import { LsxListView } from './LsxPageList/LsxListView';
import { LsxContext } from './lsx-context';

import styles from './Lsx.module.scss';


type Props = {
  children: React.ReactNode,
  className?: string,

  prefix: string,
  num?: string,
  depth?: string,
  sort?: string,
  reverse?: string,
  filter?: string,

  isImmutable?: boolean,
};

export const Lsx = React.memo(({
  prefix,
  num, depth, sort, reverse, filter,
  isImmutable,
  ...props
}: Props): JSX.Element => {

  const lsxContext = useMemo(() => {
    const options = {
      num, depth, sort, reverse, filter,
    };
    return new LsxContext(prefix, options);
  }, [depth, filter, num, prefix, reverse, sort]);

  const { data, error } = useSWRxNodeTree(lsxContext, isImmutable);

  const isLoading = data === undefined;
  const hasError = error != null;
  const errorMessage = error?.message;

  const Error = useCallback((): JSX.Element => {
    if (!hasError) {
      return <></>;
    }

    return (
      <div className="text-warning">
        <i className="fa fa-exclamation-triangle fa-fw"></i>
        {lsxContext.toString()} (-&gt; <small>{errorMessage}</small>)
      </div>
    );
  }, [errorMessage, hasError, lsxContext]);

  const Loading = useCallback((): JSX.Element => {
    if (hasError) {
      return <></>;
    }
    if (!isLoading) {
      return <></>;
    }

    return (
      <div className={`text-muted ${isLoading ? 'lsx-blink' : ''}`}>
        <small>
          <i className="fa fa-spinner fa-pulse mr-1"></i>
          {lsxContext.toString()}
        </small>
      </div>
    );
  }, [hasError, isLoading, lsxContext]);

  const contents = useMemo(() => {
    if (isLoading) {
      return <></>;
    }

    return <LsxListView nodeTree={data.nodeTree} lsxContext={lsxContext} basisViewersCount={data.toppageViewersCount} />;
  }, [data?.nodeTree, data?.toppageViewersCount, isLoading, lsxContext]);

  return (
    <div className={`lsx ${styles.lsx}`}>
      <Error />
      <Loading />
      {contents}
    </div>
  );
});
Lsx.displayName = 'Lsx';

export const LsxImmutable = React.memo((props: Omit<Props, 'isImmutable'>): JSX.Element => {
  return <Lsx {...props} isImmutable />;
});
LsxImmutable.displayName = 'LsxImmutable';
