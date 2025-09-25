import React, { useState, useEffect, type JSX } from 'react';

import type { Ref, IRevision, IRevisionHasId } from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';

import type { RendererOptions } from '~/interfaces/renderer-options';
import { useSWRxPageRevision } from '~/stores/page';
import loggerFactory from '~/utils/logger';


import RevisionRenderer from '../../../components/PageView/RevisionRenderer';

export const ROOT_ELEM_ID = 'revision-loader' as const;

export type RevisionLoaderProps = {
  rendererOptions: RendererOptions,
  pageId: string,
  revisionId: Ref<IRevision>,
  onRevisionLoaded?: (revision: IRevisionHasId) => void,
}

const logger = loggerFactory('growi:Page:RevisionLoader');

/**
 * Load data from server and render RevisionBody component
 */
export const RevisionLoader = (props: RevisionLoaderProps): JSX.Element => {
  const { t } = useTranslation();

  const {
    rendererOptions, pageId, revisionId, onRevisionLoaded,
  } = props;

  const { data: pageRevision, isLoading, error } = useSWRxPageRevision(pageId, revisionId);

  const [markdown, setMarkdown] = useState<string>('');

  useEffect(() => {
    if (pageRevision != null) {
      setMarkdown(pageRevision?.body ?? '');

      if (onRevisionLoaded != null) {
        onRevisionLoaded(pageRevision);
      }
    }

  }, [onRevisionLoaded, pageRevision]);

  useEffect(() => {
    if (error != null) {
      const isForbidden = error != null && error[0].code === 'forbidden-page';
      if (isForbidden) {
        setMarkdown(`<span className="material-symbols-outlined p-1">cancel</span>${t('not_allowed_to_see_this_page')}`);
      }
      else {
        const errorMessages = error.map((error) => {
          return `<span className="material-symbols-outlined p-1">cancel</span><span class="text-muted"><em>${error.message}</em></span>`;
        });
        setMarkdown(errorMessages.join('\n'));
      }
    }
  }, [error, t]);

  if (isLoading) {
    return (
      <div className="wiki">
        <div className="text-muted text-center">
          <LoadingSpinner className="me-1 fs-3" />
        </div>
      </div>
    );
  }

  return (
    <RevisionRenderer
      rendererOptions={rendererOptions}
      markdown={markdown}
    />
  );
};
