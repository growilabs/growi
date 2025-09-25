import type { JSX } from 'react';

import nodePath from 'path';

import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import type { IPageForItem } from '~/interfaces/page';
import { shouldRecoverPagePaths } from '~/utils/page-operation';

import styles from './SimpleItemContent.module.scss';


const moduleClass = styles['simple-item-content'] ?? '';


export const SimpleItemContent = ({ page }: { page: IPageForItem }): JSX.Element => {
  const { t } = useTranslation();

  const pageName = nodePath.basename(page.path ?? '') || '/';

  const shouldShowAttentionIcon = page.processData != null ? shouldRecoverPagePaths(page.processData) : false;

  return (
    <div
      className={`${moduleClass} flex-grow-1 d-flex align-items-center pe-none`}
      style={{ minWidth: 0 }}
    >
      {shouldShowAttentionIcon && (
        <>
          <span id="path-recovery" className="material-symbols-outlined mr-2 text-warning">warning</span>
          <UncontrolledTooltip placement="top" target="path-recovery" fade={false}>
            {t('tooltip.operation.attention.rename')}
          </UncontrolledTooltip>
        </>
      )}
      {page != null && page.path != null && page._id != null && (
        <div className="grw-page-title-anchor flex-grow-1">
          <div className="d-flex align-items-center">
            <span className={`text-truncate me-1 ${page.isEmpty && 'opacity-75'}`}>{pageName}</span>
            { page.wip && (
              <span className="wip-page-badge badge rounded-pill me-1 text-bg-secondary">WIP</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
