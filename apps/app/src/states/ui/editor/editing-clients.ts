import type { EditingClient } from '@growi/editor';
import { atom, useAtomValue, useSetAtom } from 'jotai';

// Atom definition
const editingClientsAtom = atom<EditingClient[]>([]);

// Read-only hook
export const useEditingClients = (): EditingClient[] => {
  return useAtomValue(editingClientsAtom);
};

// Setter hook
export const useSetEditingClients = () => {
  return useSetAtom(editingClientsAtom);
};
