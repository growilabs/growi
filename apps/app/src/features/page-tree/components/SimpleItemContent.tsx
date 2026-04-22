import { useRef } from 'react';
import Link from 'next/link';
import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import path from 'pathe';
import { UncontrolledTooltip } from 'reactstrap';

import type { IPageForItem } from '~/interfaces/page';
import { shouldRecoverPagePaths } from '~/utils/page-operation';

import styles from './SimpleItemContent.module.scss';

const moduleClass = styles['simple-item-content'] ?? '';

export const SimpleItemContent = ({
  page,
  asLink = false,
}: {
  page: IPageForItem;
  asLink?: boolean;
}): JSX.Element => {
  const { t } = useTranslation();

  const pageName = path.basename(page.path ?? '') || '/';

  const shouldShowAttentionIcon =
    page.processData != null ? shouldRecoverPagePaths(page.processData) : false;

  const warningIconRef = useRef<HTMLSpanElement>(null);

  // When asLink is true, render the title as an anchor so that the browser
  // recognizes it as a link (enables Ctrl/Cmd+click to open in new tab,
  // middle-click, and the right-click "Open link in new tab" context menu).
  // Otherwise we render a plain div and let the surrounding <li> capture
  // clicks via JS (existing non-navigation usages such as modals).
  const href =
    asLink && page.path != null && page._id != null
      ? pathUtils.returnPathForURL(page.path, page._id)
      : undefined;

  const titleClassName = `grw-page-title-anchor flex-grow-1 text-truncate ${page.isEmpty ? 'opacity-75' : ''}`;

  return (
    <div
      className={`${moduleClass} flex-grow-1 d-flex align-items-center ${href != null ? '' : 'pe-none'}`}
      style={{ minWidth: 0 }}
    >
      {shouldShowAttentionIcon && (
        <>
          <span
            ref={warningIconRef}
            className="material-symbols-outlined mr-2 text-warning"
          >
            warning
          </span>
          <UncontrolledTooltip
            placement="top"
            target={warningIconRef}
            fade={false}
          >
            {t('tooltip.operation.attention.rename')}
          </UncontrolledTooltip>
        </>
      )}
      {page != null &&
        page.path != null &&
        page._id != null &&
        (href != null ? (
          <Link
            href={href}
            prefetch={false}
            className={`${titleClassName} text-reset`}
            style={{ minWidth: 0 }}
          >
            {pageName}
          </Link>
        ) : (
          <div className={titleClassName} style={{ minWidth: 0 }}>
            {pageName}
          </div>
        ))}
      {/* WIP is a status indicator — kept outside the link so it is not
          read as part of the anchor's accessible name, and not truncated. */}
      {page.wip && (
        <span className="wip-page-badge badge rounded-pill ms-1 text-bg-secondary flex-shrink-0">
          WIP
        </span>
      )}
    </div>
  );
};
