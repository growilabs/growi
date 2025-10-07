import type { ColorScheme } from '@growi/core';
import { atom, useAtomValue, useSetAtom } from 'jotai';


const resolvedThemeAtom = atom<ColorScheme>();

export const useResolvedTheme = () => useAtomValue(resolvedThemeAtom);

export const useSetResolvedTheme = () => useSetAtom(resolvedThemeAtom);
