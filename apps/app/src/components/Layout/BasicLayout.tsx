import type { JSX, ReactNode } from 'react';
import dynamic from 'next/dynamic';

// eslint-disable-next-line no-restricted-imports
import { DeleteBookmarkFolderModalLazyLoaded } from '~/client/components/DeleteBookmarkFolderModal';
import { GrantedGroupsInheritanceSelectModalLazyLoaded } from '~/client/components/GrantedGroupsInheritanceSelectModal';
import { PageAccessoriesModalLazyLoaded } from '~/client/components/PageAccessoriesModal';
// eslint-disable-next-line no-restricted-imports
import { DeleteAttachmentModalLazyLoaded } from '~/client/components/PageAttachment';
import { PageDeleteModalLazyLoaded } from '~/client/components/PageDeleteModal';
import { PageDuplicateModalLazyLoaded } from '~/client/components/PageDuplicateModal';
import { PagePresentationModalLazyLoaded } from '~/client/components/PagePresentationModal';
import { PageRenameModalLazyLoaded } from '~/client/components/PageRenameModal';
// eslint-disable-next-line no-restricted-imports
import { PageSelectModalLazyLoaded } from '~/client/components/PageSelectModal';
// eslint-disable-next-line no-restricted-imports
import { PutBackPageModalLazyLoaded } from '~/client/components/PutbackPageModal';
import { ShortcutsModalLazyLoaded } from '~/client/components/ShortcutsModal';
// eslint-disable-next-line no-restricted-imports
import { AiAssistantManagementModalLazyLoaded } from '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal';
import { PageBulkExportSelectModalLazyLoaded } from '~/features/page-bulk-export/client/components';

import { RawLayout } from './RawLayout';

import styles from './BasicLayout.module.scss';

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
const SystemVersion = dynamic(
  () => import('~/client/components/SystemVersion'),
  { ssr: false },
);
// Page modals
const PageCreateModal = dynamic(
  () => import('~/client/components/PageCreateModal'),
  { ssr: false },
);
const SearchModal = dynamic(
  () => import('~/features/search/client/components/SearchModal'),
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
      <SystemVersion showShortcutsButton />
    </RawLayout>
  );
};
