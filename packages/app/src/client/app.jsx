import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'unstated';
import { I18nextProvider } from 'react-i18next';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { SWRConfig } from 'swr';

import loggerFactory from '~/utils/logger';
import { swrGlobalConfiguration } from '~/utils/swr-utils';

import InAppNotificationPage from '../components/InAppNotification/InAppNotificationPage';
import ErrorBoundary from '../components/ErrorBoudary';
import Sidebar from '../components/Sidebar';
import { SearchPage } from '../components/SearchPage';
import TagsList from '../components/TagsList';
import DisplaySwitcher from '../components/Page/DisplaySwitcher';
import { defaultEditorOptions, defaultPreviewOptions } from '../components/PageEditor/OptionsSelector';
import Page from '../components/Page';
import PageContentFooter from '../components/PageContentFooter';
import PageComment from '../components/PageComment';
import PageTimeline from '../components/PageTimeline';
import CommentEditorLazyRenderer from '../components/PageComment/CommentEditorLazyRenderer';
import ShareLinkAlert from '../components/Page/ShareLinkAlert';
import RedirectedAlert from '../components/Page/RedirectedAlert';
import TrashPageList from '../components/TrashPageList';
import TrashPageAlert from '../components/Page/TrashPageAlert';
import NotFoundPage from '../components/NotFoundPage';
import NotFoundAlert from '../components/Page/NotFoundAlert';
import ForbiddenPage from '../components/ForbiddenPage';
import PageStatusAlert from '../components/PageStatusAlert';
import RecentCreated from '../components/RecentCreated/RecentCreated';
import RecentlyCreatedIcon from '../components/Icons/RecentlyCreatedIcon';
import MyDraftList from '../components/MyDraftList/MyDraftList';
import BookmarkList from '../components/PageList/BookmarkList';
import Fab from '../components/Fab';
import PersonalSettings from '../components/Me/PersonalSettings';
import GrowiContextualSubNavigation from '../components/Navbar/GrowiContextualSubNavigation';
import GrowiSubNavigationSwitcher from '../components/Navbar/GrowiSubNavigationSwitcher';
import IdenticalPathPage from '~/components/IdenticalPathPage';

import ContextExtractor from '~/client/services/ContextExtractor';
import PageContainer from '~/client/services/PageContainer';
import PageHistoryContainer from '~/client/services/PageHistoryContainer';
import RevisionComparerContainer from '~/client/services/RevisionComparerContainer';
import CommentContainer from '~/client/services/CommentContainer';
import EditorContainer from '~/client/services/EditorContainer';
import TagContainer from '~/client/services/TagContainer';
import PersonalContainer from '~/client/services/PersonalContainer';

import { appContainer, componentMappings } from './base';
import { toastError } from './util/apiNotification';
import { PrivateLegacyPages } from '~/components/PrivateLegacyPages';

const logger = loggerFactory('growi:cli:app');

appContainer.initContents();

const { i18n } = appContainer;
const socketIoContainer = appContainer.getContainer('SocketIoContainer');

// create unstated container instance
const pageContainer = new PageContainer(appContainer);
const pageHistoryContainer = new PageHistoryContainer(appContainer, pageContainer);
const revisionComparerContainer = new RevisionComparerContainer(appContainer, pageContainer);
const commentContainer = new CommentContainer(appContainer);
const editorContainer = new EditorContainer(appContainer, defaultEditorOptions, defaultPreviewOptions);
const tagContainer = new TagContainer(appContainer);
const personalContainer = new PersonalContainer(appContainer);
const injectableContainers = [
  appContainer, socketIoContainer, pageContainer, pageHistoryContainer, revisionComparerContainer,
  commentContainer, editorContainer, tagContainer, personalContainer,
];

logger.info('unstated containers have been initialized');

/**
 * define components
 *  key: id of element
 *  value: React Element
 */
Object.assign(componentMappings, {
  'grw-sidebar-wrapper': <Sidebar />,

  'search-page': <SearchPage appContainer={appContainer} />,
  'private-regacy-pages': <PrivateLegacyPages appContainer={appContainer} />,

  'all-in-app-notifications': <InAppNotificationPage />,
  'identical-path-page': <IdenticalPathPage />,

  // 'revision-history': <PageHistory pageId={pageId} />,
  'tags-page': <TagsList crowi={appContainer} />,

  'grw-page-status-alert-container': <PageStatusAlert />,

  'trash-page-alert': <TrashPageAlert />,

  'trash-page-list-container': <TrashPageList />,

  'not-found-page': <NotFoundPage />,

  'forbidden-page': <ForbiddenPage isLinkSharingDisabled={appContainer.config.disableLinkSharing} />,

  'page-timeline': <PageTimeline />,

  'personal-setting': <PersonalSettings crowi={personalContainer} />,

  'my-drafts': <MyDraftList />,

  'grw-fab-container': <Fab />,

  'share-link-alert': <ShareLinkAlert />,
  'redirected-alert': <RedirectedAlert />,
  'not-found-alert': <NotFoundAlert
    isGuestUserMode={appContainer.isGuestUser}
  />,
});

// additional definitions if data exists
if (pageContainer.state.pageId != null) {
  Object.assign(componentMappings, {
    'page-comments-list': <PageComment appContainer={appContainer} pageId={pageContainer.state.pageId} isReadOnly={false} titleAlign="left" />,
    'page-comment-write': <CommentEditorLazyRenderer appContainer={appContainer} pageId={pageContainer.state.pageId} />,
    'page-content-footer': <PageContentFooter
      createdAt={new Date(pageContainer.state.createdAt)}
      updatedAt={new Date(pageContainer.state.updatedAt)}
      creator={pageContainer.state.creator}
      revisionAuthor={pageContainer.state.revisionAuthor}
    />,

    'recent-created-icon': <RecentlyCreatedIcon />,
  });

  // show the Page accessory modal when query of "compare" is requested
  if (revisionComparerContainer.getRevisionIDsToCompareAsParam().length > 0) {
    toastError('Sorry, opening PageAccessoriesModal is not implemented yet in v5.');
  //   pageAccessoriesContainer.openPageAccessoriesModal('pageHistory');
  }
}
if (pageContainer.state.creator != null) {
  Object.assign(componentMappings, {
    'user-created-list': <RecentCreated userId={pageContainer.state.creator._id} />,
    'user-bookmark-list': <BookmarkList userId={pageContainer.state.creator._id} />,
  });
}
if (pageContainer.state.path != null) {
  Object.assign(componentMappings, {
    // eslint-disable-next-line quote-props
    'page': <Page />,
    'grw-subnav-container': <GrowiContextualSubNavigation isLinkSharingDisabled={appContainer.config.disableLinkSharing} />,
    'grw-subnav-switcher-container': <GrowiSubNavigationSwitcher isLinkSharingDisabled={appContainer.config.disableLinkSharing} />,
    'display-switcher': <DisplaySwitcher />,
  });
}

const renderMainComponents = () => {
  Object.keys(componentMappings).forEach((key) => {
    const elem = document.getElementById(key);
    if (elem) {
      ReactDOM.render(
        <I18nextProvider i18n={i18n}>
          <ErrorBoundary>
            <SWRConfig value={swrGlobalConfiguration}>
              <Provider inject={injectableContainers}>
                <DndProvider backend={HTML5Backend}>
                  {componentMappings[key]}
                </DndProvider>
              </Provider>
            </SWRConfig>
          </ErrorBoundary>
        </I18nextProvider>,
        elem,
      );
    }
  });
};

// extract context before rendering main components
const elem = document.getElementById('growi-context-extractor');
if (elem != null) {
  ReactDOM.render(
    <SWRConfig value={swrGlobalConfiguration}>
      <ContextExtractor></ContextExtractor>
    </SWRConfig>,
    elem,
    renderMainComponents,
  );
}
else {
  renderMainComponents();
}

// initialize scrollpos-styler
ScrollPosStyler.init();
