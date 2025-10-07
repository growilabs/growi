import dynamic from 'next/dynamic';
import type { JSX, ReactNode } from 'react';
import React from 'react';
import styles from './BasicLayout.module.scss';
import { RawLayout } from './RawLayout';

const AiAssistantSidebar = dynamic(
  () =>
    import(
      '~/features/openai/client/components/AiAssistant/AiAssistantSidebar/AiAssistantSidebar'
    ).then((mod) => mod.AiAssistantSidebar),
  { ssr: false },
);

const moduleClass = styles['grw-basic-layout'] ?? '';

const Sidebar = dynamic(
  () => import('~/client/components/Sidebar').then((mod) => mod.Sidebar),
  { ssr: false },
);

const AlertSiteUrlUndefined = dynamic(
  () =>
    import('~/client/components/AlertSiteUrlUndefined').then(
      (mod) => mod.AlertSiteUrlUndefined,
    ),
  { ssr: false },
);
const DeleteAttachmentModal = dynamic(
  () =>
    import('~/client/components/PageAttachment/DeleteAttachmentModal').then(
      (mod) => mod.DeleteAttachmentModal,
    ),
  { ssr: false },
);
const HotkeysManager = dynamic(
  () => import('~/client/components/Hotkeys/HotkeysManager'),
  { ssr: false },
);
const GrowiNavbarBottom = dynamic(
  () =>
    import('~/client/components/Navbar/GrowiNavbarBottom').then(
      (mod) => mod.GrowiNavbarBottom,
    ),
  { ssr: false },
);
const ShortcutsModal = dynamic(
  () => import('~/client/components/ShortcutsModal'),
  { ssr: false },
);
const SystemVersion = dynamic(
  () => import('~/client/components/SystemVersion'),
  { ssr: false },
);
const PutbackPageModal = dynamic(
  () => import('~/client/components/PutbackPageModal'),
  { ssr: false },
);
// Page modals
const PageCreateModal = dynamic(
  () => import('~/client/components/PageCreateModal'),
  { ssr: false },
);
const PageDuplicateModal = dynamic(
  () => import('~/client/components/PageDuplicateModal'),
  { ssr: false },
);
const PageDeleteModal = dynamic(
  () => import('~/client/components/PageDeleteModal'),
  { ssr: false },
);
const PageRenameModal = dynamic(
  () => import('~/client/components/PageRenameModal'),
  { ssr: false },
);
const PagePresentationModal = dynamic(
  () => import('~/client/components/PagePresentationModal'),
  { ssr: false },
);
const PageAccessoriesModal = dynamic(
  () =>
    import('~/client/components/PageAccessoriesModal').then(
      (mod) => mod.PageAccessoriesModal,
    ),
  { ssr: false },
);
const GrantedGroupsInheritanceSelectModal = dynamic(
  () => import('~/client/components/GrantedGroupsInheritanceSelectModal'),
  { ssr: false },
);
const DeleteBookmarkFolderModal = dynamic(
  () =>
    import('~/client/components/DeleteBookmarkFolderModal').then(
      (mod) => mod.DeleteBookmarkFolderModal,
    ),
  { ssr: false },
);
const SearchModal = dynamic(
  () => import('../../features/search/client/components/SearchModal'),
  { ssr: false },
);
const PageBulkExportSelectModal = dynamic(
  () =>
    import(
      '../../features/page-bulk-export/client/components/PageBulkExportSelectModal'
    ),
  { ssr: false },
);

const AiAssistantManagementModal = dynamic(
  () =>
    import(
      '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal/AiAssistantManagementModal'
    ).then((mod) => mod.AiAssistantManagementModal),
  { ssr: false },
);
const PageSelectModal = dynamic(
  () =>
    import('~/client/components/PageSelectModal/PageSelectModal').then(
      (mod) => mod.PageSelectModal,
    ),
  { ssr: false },
);

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

        <AiAssistantSidebar />
      </div>

      <GrowiNavbarBottom />

      <PageCreateModal />
      <PageDuplicateModal />
      <PageDeleteModal />
      <PageRenameModal />
      <PageAccessoriesModal />
      <DeleteAttachmentModal />
      <DeleteBookmarkFolderModal />
      <PutbackPageModal />
      <PageSelectModal />
      <SearchModal />
      <AiAssistantManagementModal />

      <PagePresentationModal />
      <HotkeysManager />

      <ShortcutsModal />
      <PageBulkExportSelectModal />
      <GrantedGroupsInheritanceSelectModal />
      <SystemVersion showShortcutsButton />
    </RawLayout>
  );
};
