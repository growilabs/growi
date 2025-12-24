import type { JSX, ReactNode } from 'react';
import dynamic from 'next/dynamic';

// biome-ignore lint/style/noRestrictedImports: no-problem lazy loaded components
import { ShortcutsModalLazyLoaded } from '~/client/components/ShortcutsModal';

import { RawLayout } from './RawLayout';

// biome-ignore-start lint/style/noRestrictedImports: no-problem dynamic import
const PageCreateModal = dynamic(
  () => import('~/client/components/PageCreateModal'),
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
// biome-ignore-end lint/style/noRestrictedImports: no-problem dynamic import

type Props = {
  children?: ReactNode;
};

export const ShareLinkLayout = ({ children }: Props): JSX.Element => {
  return (
    <RawLayout>
      <div className="page-wrapper">{children}</div>

      <GrowiNavbarBottom />

      <ShortcutsModalLazyLoaded />
      <PageCreateModal />
      <SystemVersion showShortcutsButton />
    </RawLayout>
  );
};
