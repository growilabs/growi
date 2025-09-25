import React, { useCallback, type JSX } from 'react';

import { pagePathUtils } from '@growi/core/dist/utils';
import ReactMarkdown from 'react-markdown';

import { useCurrentPagePath } from '~/stores/page';
import { useTocOptions } from '~/stores/renderer';
import loggerFactory from '~/utils/logger';

import { StickyStretchableScroller } from './StickyStretchableScroller';

import styles from './TableOfContents.module.scss';

const { isUsersHomepage: _isUsersHomepage } = pagePathUtils;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:TableOfContents');

type Props = {
  tagsElementHeight?: number
}

const TableOfContents = ({ tagsElementHeight }: Props): JSX.Element => {
  const { data: currentPagePath } = useCurrentPagePath();

  const isUsersHomePage = currentPagePath != null && _isUsersHomepage(currentPagePath);

  const { data: rendererOptions } = useTocOptions();

  const calcViewHeight = useCallback(() => {
    // calculate absolute top of '#revision-toc' element
    const parentElem = document.querySelector('.grw-side-contents-container');
    const containerElem = document.querySelector('#revision-toc');

    // rendererOptions for redo calcViewHeight()
    // see: https://github.com/growilabs/growi/pull/6791
    if (parentElem == null || containerElem == null || rendererOptions == null || tagsElementHeight == null) {
      return 0;
    }
    const parentBottom = parentElem.getBoundingClientRect().bottom;
    const containerTop = containerElem.getBoundingClientRect().top;
    const containerComputedStyle = getComputedStyle(containerElem);
    const containerPaddingTop = parseFloat(containerComputedStyle['padding-top']);

    // get smaller bottom line of window height - .system-version height - margin 5px) and containerTop
    let bottom = Math.min(window.innerHeight - 20 - 5, parentBottom);

    if (isUsersHomePage) {
      // raise the bottom line by the height and margin-top of UserContentLinks
      bottom -= 90;
    }
    // bottom - revisionToc top
    return bottom - (containerTop + containerPaddingTop);
  }, [isUsersHomePage, rendererOptions, tagsElementHeight]);

  return (
    <div id="revision-toc" className={`revision-toc ${styles['revision-toc']}`}>
      <StickyStretchableScroller
        stickyElemSelector=".grw-side-contents-sticky-container"
        calcViewHeight={calcViewHeight}
      >
        <div
          id="revision-toc-content"
          data-testid="revision-toc-content"
          className="revision-toc-content mb-3"
        >
          {/* parse blank to show toc (https://github.com/growilabs/growi/pull/6277) */}
          <ReactMarkdown {...rendererOptions}>{' '}</ReactMarkdown>
        </div>
      </StickyStretchableScroller>
    </div>
  );

};

export default TableOfContents;
