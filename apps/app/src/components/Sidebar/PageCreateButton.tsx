import React, { useCallback, useState } from 'react';

import { useRouter } from 'next/router';

import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError } from '~/client/util/toastr';
import { useSWRxCurrentPage } from '~/stores/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:cli:PageCreateButton');

export const PageCreateButton = React.memo((): JSX.Element => {
  const router = useRouter();
  const { data: currentPage, isLoading } = useSWRxCurrentPage();

  const [isHovered, setIsHovered] = useState(false);

  const onMouseEnterHandler = () => {
    setIsHovered(true);
  };

  const onMouseLeaveHandler = () => {
    setIsHovered(false);
  };

  const onCreateNewPageButtonHandler = useCallback(async() => {
    if (isLoading) return;

    try {
      const parentPath = currentPage?.path || '/';

      const response = await apiv3Get('/pages/unique-path', { parentPath });

      await apiv3Post('/pages/', {
        path: response.data.uniquePath,
        body: undefined,
        grant: currentPage?.grant || 1,
        grantUserGroupId: currentPage?.grantedGroup || null,
      });

      router.push(`${response.data.uniquePath}#edit`);
    }
    catch (err) {
      logger.warn(err);
      toastError(err);
    }
  }, [currentPage, isLoading, router]);

  const onCreateTodaysButtonHandler = useCallback(() => {
    // router.push(`${router.pathname}#edit`);
  }, [router]);
  const onTemplateForChildrenButtonHandler = useCallback(() => {
    // router.push(`${router.pathname}/_template#edit`);
  }, [router]);
  const onTemplateForDescendantsButtonHandler = useCallback(() => {
    // router.push(`${router.pathname}/__template#edit`);
  }, [router]);

  // TODO: update button design
  // https://redmine.weseek.co.jp/issues/132683
  // TODO: i18n
  // https://redmine.weseek.co.jp/issues/132681
  return (
    <div
      className="d-flex flex-row"
      onMouseEnter={onMouseEnterHandler}
      onMouseLeave={onMouseLeaveHandler}
    >
      <div className="btn-group">
        <button
          className="d-block btn btn-primary"
          onClick={onCreateNewPageButtonHandler}
          type="button"
          data-testid="grw-sidebar-nav-page-create-button"
        >
          <i className="material-icons">create</i>
        </button>
      </div>
      {isHovered && (
        <div className="btn-group dropend">
          <button
            className="btn btn-secondary dropdown-toggle dropdown-toggle-split position-absolute"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          />
          <ul className="dropdown-menu">
            <li>
              <button
                className="dropdown-item"
                onClick={onCreateNewPageButtonHandler}
                type="button"
              >
                Create New Page
              </button>
            </li>
            <li><hr className="dropdown-divider" /></li>
            <li><span className="text-muted px-3">Create today&apos;s ...</span></li>
            {/* TODO: show correct create today's page path */}
            {/* https://redmine.weseek.co.jp/issues/132682 */}
            <li>
              <button
                className="dropdown-item"
                onClick={onCreateTodaysButtonHandler}
                type="button"
              >
                Create today&apos;s
              </button>
            </li>
            <li><hr className="dropdown-divider" /></li>
            <li><span className="text-muted px-3">Child page template</span></li>
            <li>
              <button
                className="dropdown-item"
                onClick={onTemplateForChildrenButtonHandler}
                type="button"
              >
                Template for children
              </button>
            </li>
            <li>
              <button
                className="dropdown-item"
                onClick={onTemplateForDescendantsButtonHandler}
                type="button"
              >
                Template for descendants
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
});
PageCreateButton.displayName = 'PageCreateButton';
