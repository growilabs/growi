import type { JSX, ReactNode } from 'react';
import dynamic from 'next/dynamic';

// biome-ignore-start lint/style/noRestrictedImports: no-problem lazy loaded components
import { AlertSiteUrlUndefined } from '~/client/components/AlertSiteUrlUndefined.js';
import { DeleteBookmarkFolderModalLazyLoaded } from '~/client/components/DeleteBookmarkFolderModal/index.js';
import { GrantedGroupsInheritanceSelectModalLazyLoaded } from '~/client/components/GrantedGroupsInheritanceSelectModal/index.js';
import { PageAccessoriesModalLazyLoaded } from '~/client/components/PageAccessoriesModal/index.js';
import { DeleteAttachmentModalLazyLoaded } from '~/client/components/PageAttachment/index.js';
import { PageDeleteModalLazyLoaded } from '~/client/components/PageDeleteModal/index.js';
import { PageDuplicateModalLazyLoaded } from '~/client/components/PageDuplicateModal/index.js';
import { PagePresentationModalLazyLoaded } from '~/client/components/PagePresentationModal/index.js';
import { PageRenameModalLazyLoaded } from '~/client/components/PageRenameModal/index.js';
import { PageSelectModalLazyLoaded } from '~/client/components/PageSelectModal/index.js';
import { PutBackPageModalLazyLoaded } from '~/client/components/PutbackPageModal/index.js';
import { ShortcutsModalLazyLoaded } from '~/client/components/ShortcutsModal/index.js';
import { AiAssistantManagementModalLazyLoaded } from '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal/index.js';
import { AiAssistantSidebarLazyLoaded } from '~/features/openai/client/components/AiAssistant/AiAssistantSidebar/index.js';
import { PageBulkExportSelectModalLazyLoaded } from '~/features/page-bulk-export/client/components/index.js';

// biome-ignore-end lint/style/noRestrictedImports: no-problem lazy loaded components

import { RawLayout } from './RawLayout.js';

import styles from './BasicLayout.module.scss';

const moduleClass = styles['grw-basic-layout'] ?? '';

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
const Sidebar = dynamic(
  () => import('~/client/components/Sidebar/index.js').then((mod) => mod.Sidebar),
  { ssr: false },
);

const HotkeysManager = dynamic(
  () => import('~/client/components/Hotkeys/HotkeysManager.js'),
  { ssr: false },
);
const GrowiNavbarBottom = dynamic(
  () =>
    import('~/client/components/Navbar/GrowiNavbarBottom.js').then(
      (mod) => mod.GrowiNavbarBottom,
    ),
  { ssr: false },
);
// Page modals
const PageCreateModal = dynamic(
  () => import('~/client/components/PageCreateModal.js'),
  { ssr: false },
);
const SearchModal = dynamic(
  () => import('~/features/search/client/components/SearchModal.js'),
  { ssr: false },
);
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

type Props = {
  children?: ReactNode;
  className?: string;
};

export const BasicLayout = ({ children, className }: Props): JSX.Element => {
  return (
    <RawLayout className={`${moduleClass} ${className ?? ''}`}>
      <div className="page-wrapper flex-row">
        <div className="z-2 d-print-none">
          <Sidebar />
        </div>

        <div className="d-flex flex-grow-1 flex-column mw-0 z-1">
          {/* neccessary for nested {children} make expanded */}
          <AlertSiteUrlUndefined />
          {children}
        </div>

        <AiAssistantSidebarLazyLoaded />
      </div>

      <GrowiNavbarBottom />
      <SearchModal />

      <PageCreateModal />
      <PageDuplicateModalLazyLoaded />
      <PageDeleteModalLazyLoaded />
      <PageRenameModalLazyLoaded />
      <PageAccessoriesModalLazyLoaded />
      <DeleteAttachmentModalLazyLoaded />
      <DeleteBookmarkFolderModalLazyLoaded />
      <PutBackPageModalLazyLoaded />
      <PageSelectModalLazyLoaded />
      <AiAssistantManagementModalLazyLoaded />

      <PagePresentationModalLazyLoaded />
      <HotkeysManager />

      <ShortcutsModalLazyLoaded />
      <PageBulkExportSelectModalLazyLoaded />
      <GrantedGroupsInheritanceSelectModalLazyLoaded />
    </RawLayout>
  );
};
