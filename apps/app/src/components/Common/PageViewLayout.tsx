import type { ReactNode } from 'react';

import styles from './PageViewLayout.module.scss';

type Props = {
  children?: ReactNode,
  headerContents?: ReactNode,
  sideContents?: ReactNode,
  footerContents?: ReactNode,
}

export const PageViewLayout = (props: Props): JSX.Element => {
  const {
    children, headerContents, sideContents, footerContents,
  } = props;

  return (
    <>
      <div id="main" className={`main ${styles['page-view-layout']}`}>
        <div id="content-main" className="content-main container-lg grw-container-convertible">
          { headerContents != null && headerContents }
          { sideContents != null
            ? (
              <div className="d-flex gap-3">
                <div className="flex-grow-1 flex-basis-0 mw-0">
                  {children}
                </div>
                <div className="grw-side-contents-container col-lg-3  d-edit-none d-print-none" data-vrt-blackout-side-contents>
                  <div className="grw-side-contents-sticky-container">
                    {sideContents}
                  </div>
                </div>
              </div>
            )
            : (
              <>{children}</>
            )
          }
        </div>
      </div>

      { footerContents != null && (
        <footer className="footer d-edit-none">
          {footerContents}
        </footer>
      ) }
    </>
  );
};
