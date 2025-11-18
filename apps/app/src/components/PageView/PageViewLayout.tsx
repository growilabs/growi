import type { JSX, ReactNode } from 'react';

import { usePrintMode } from '~/client/services/use-print-mode';

import styles from './PageViewLayout.module.scss';

const pageViewLayoutClass = styles['page-view-layout'] ?? '';
const _fluidLayoutClass = styles['fluid-layout'] ?? '';

type Props = {
  className?: string;
  children?: ReactNode;
  headerContents?: ReactNode;
  sideContents?: ReactNode;
  footerContents?: ReactNode;
  expandContentWidth?: boolean;
};

export const PageViewLayout = (props: Props): JSX.Element => {
  const {
    className,
    children,
    headerContents,
    sideContents,
    footerContents,
    expandContentWidth,
  } = props;

  const isPrinting = usePrintMode();

  const fluidLayoutClass = expandContentWidth ? _fluidLayoutClass : '';

  return (
    <>
      <div
        className={`main ${className} ${pageViewLayoutClass} ${fluidLayoutClass} flex-expand-vert ps-sidebar`}
      >
        <div className="container-lg wide-gutter-x-lg grw-container-convertible flex-expand-vert">
          {headerContents != null && headerContents}
          {!isPrinting && sideContents != null ? (
            <div className="flex-expand-horiz gap-3 z-0">
              <div className="flex-expand-vert flex-basis-0 mw-0">
                {children}
              </div>
              <div
                className="grw-side-contents-container col-lg-3 d-edit-none"
                data-vrt-blackout-side-contents
              >
                <div className="grw-side-contents-sticky-container">
                  {sideContents}
                </div>
              </div>
            </div>
          ) : (
            <div className="z-0">{children}</div>
          )}
        </div>
      </div>

      {footerContents != null && (
        <footer
          className={`footer d-edit-none container-lg wide-gutter-x-lg ${fluidLayoutClass}`}
        >
          {footerContents}
        </footer>
      )}
    </>
  );
};
