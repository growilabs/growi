import { atom, useAtomValue, useSetAtom } from 'jotai';

// Page Controls X coordinate atom
// Stores the x coordinate of the PageControls component for layout calculations
const pageControlsXAtom = atom<number | undefined>(undefined);

/**
 * Hook to get the x coordinate of PageControls component
 * Used for layout calculations in PageHeader and PagePathNavSticky
 */
export const usePageControlsX = () => useAtomValue(pageControlsXAtom);

/**
 * Hook to set the x coordinate of PageControls component
 * Used specifically in PageControls component to update the position
 */
export const useSetPageControlsX = () => useSetAtom(pageControlsXAtom);
