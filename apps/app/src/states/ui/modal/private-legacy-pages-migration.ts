import { atom, useAtomValue, useSetAtom } from 'jotai';

// Legacy private page type
export type ILegacyPrivatePage = { pageId: string; path: string };

// Submit handler type for legacy pages migration modal
export type PrivateLegacyPagesMigrationModalSubmitedHandler = (
  pages: ILegacyPrivatePage[],
  isRecursively?: boolean,
) => void;

// State type for private legacy pages migration modal
type PrivateLegacyPagesMigrationModalState = {
  isOpened: boolean;
  pages?: ILegacyPrivatePage[];
  onSubmit?: PrivateLegacyPagesMigrationModalSubmitedHandler;
};

// Atom definition
const privateLegacyPagesMigrationModalAtom =
  atom<PrivateLegacyPagesMigrationModalState>({
    isOpened: false,
  });

// Read-only hook
export const usePrivateLegacyPagesMigrationModalStatus = () => {
  return useAtomValue(privateLegacyPagesMigrationModalAtom);
};

// Actions-only hook
export const usePrivateLegacyPagesMigrationModalActions = () => {
  const setState = useSetAtom(privateLegacyPagesMigrationModalAtom);

  const open = (
    pages: ILegacyPrivatePage[],
    onSubmit: PrivateLegacyPagesMigrationModalSubmitedHandler,
  ) => {
    setState({ isOpened: true, pages, onSubmit });
  };

  const close = () => {
    setState({ isOpened: false });
  };

  return { open, close };
};
