import React, { type JSX } from 'react';

import RevisionRenderer from '~/components/PageView/RevisionRenderer.js';
import { useSWRxPageByPath } from '~/stores/page.js';
import { useCustomSidebarOptions } from '~/stores/renderer.js';
import loggerFactory from '~/utils/logger/index.js';

import { SidebarNotFound } from './CustomSidebarNotFound.js';

import styles from './CustomSidebarSubstance.module.scss';

const logger = loggerFactory('growi:components:CustomSidebarSubstance');

export const CustomSidebarSubstance = (): JSX.Element => {
  const { data: rendererOptions } = useCustomSidebarOptions({ suspense: true });
  const { data: page } = useSWRxPageByPath('/Sidebar', { suspense: true });

  if (rendererOptions == null) return <></>;

  const markdown = page?.revision?.body;

  return (
    <div
      className={`py-4 grw-custom-sidebar-content ${styles['grw-custom-sidebar-content']}`}
    >
      {markdown == null ? (
        <SidebarNotFound />
      ) : (
        <RevisionRenderer
          rendererOptions={rendererOptions}
          markdown={markdown}
        />
      )}
    </div>
  );
};
