import { atom, useAtomValue, useSetAtom } from 'jotai';

/**
 * Atom for editing markdown content
 */
export const editingMarkdownAtom = atom<string>('');

/**
 * Hook to get the current markdown being edited
 */
export const useEditingMarkdown = () => useAtomValue(editingMarkdownAtom);

/**
 * Hook to set the markdown being edited
 */
export const useSetEditingMarkdown = () => useSetAtom(editingMarkdownAtom);
