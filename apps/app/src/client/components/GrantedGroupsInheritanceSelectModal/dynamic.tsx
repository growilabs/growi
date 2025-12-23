import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { useGrantedGroupsInheritanceSelectModalStatus } from '~/states/ui/modal/granted-groups-inheritance-select';

type GrantedGroupsInheritanceSelectModalProps = Record<string, unknown>;

export const GrantedGroupsInheritanceSelectModalLazyLoaded = (): JSX.Element => {
  const status = useGrantedGroupsInheritanceSelectModalStatus();

  const GrantedGroupsInheritanceSelectModal = useLazyLoader<GrantedGroupsInheritanceSelectModalProps>(
    'granted-groups-inheritance-select-modal',
    () => import('./GrantedGroupsInheritanceSelectModal').then(mod => ({ default: mod.GrantedGroupsInheritanceSelectModal })),
    status?.isOpened ?? false,
  );

  return GrantedGroupsInheritanceSelectModal ? <GrantedGroupsInheritanceSelectModal /> : <></>;
};
