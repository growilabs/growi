import { atom, useAtomValue, useSetAtom } from 'jotai';

// State type for granted groups inheritance select modal
type GrantedGroupsInheritanceSelectModalState = {
  isOpened: boolean;
  onCreateBtnClick?: (
    onlyInheritUserRelatedGrantedGroups?: boolean,
  ) => Promise<void>;
};

// Atom definition
const grantedGroupsInheritanceSelectModalAtom =
  atom<GrantedGroupsInheritanceSelectModalState>({
    isOpened: false,
  });

// Read-only hook
export const useGrantedGroupsInheritanceSelectModalStatus = () => {
  return useAtomValue(grantedGroupsInheritanceSelectModalAtom);
};

// Actions-only hook
export const useGrantedGroupsInheritanceSelectModalActions = () => {
  const setState = useSetAtom(grantedGroupsInheritanceSelectModalAtom);

  const open = (
    onCreateBtnClick?: (
      onlyInheritUserRelatedGrantedGroups?: boolean,
    ) => Promise<void>,
  ) => {
    setState({ isOpened: true, onCreateBtnClick });
  };

  const close = () => {
    setState({ isOpened: false });
  };

  return { open, close };
};
