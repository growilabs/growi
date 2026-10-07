import { atom, useAtomValue, useSetAtom } from 'jotai';

// Resolve conflict handler type
type ResolveConflictHandler = (newMarkdown: string) => Promise<void> | void;

// State type for conflict diff modal
type ConflictDiffModalState = {
  isOpened: boolean;
  requestRevisionBody?: string;
  onResolve?: ResolveConflictHandler;
};

// Atom definition
const conflictDiffModalAtom = atom<ConflictDiffModalState>({
  isOpened: false,
});

// Read-only hook
export const useConflictDiffModalStatus = () => {
  return useAtomValue(conflictDiffModalAtom);
};

// Actions-only hook
export const useConflictDiffModalActions = () => {
  const setState = useSetAtom(conflictDiffModalAtom);

  const open = (
    requestRevisionBody: string,
    onResolve: ResolveConflictHandler,
  ) => {
    setState({ isOpened: true, requestRevisionBody, onResolve });
  };

  const close = () => {
    setState({
      isOpened: false,
      requestRevisionBody: undefined,
      onResolve: undefined,
    });
  };

  return { open, close };
};
