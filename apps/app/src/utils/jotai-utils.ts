import type { PrimitiveAtom } from 'jotai';

export const createAtomTuple = <T>(
  atom: PrimitiveAtom<T>,
  value: T,
): [PrimitiveAtom<T>, T] => [atom, value];
