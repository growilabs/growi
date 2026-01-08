import { useEffect, useState } from 'react';

import type { AnyUnstatedContainer } from './types';

/**
 * Helper hook to dynamically load and instantiate unstated containers for admin pages.
 * Pass an array of async factory functions returning container instances.
 */
export const useUnstatedContainers = (
  factories: Array<() => Promise<AnyUnstatedContainer>>,
): AnyUnstatedContainer[] => {
  const [containers, setContainers] = useState<AnyUnstatedContainer[]>([]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const resolved = await Promise.all(factories.map((f) => f()));
      if (!canceled) setContainers(resolved);
    })();
    return () => {
      canceled = true;
    };
  }, [factories]);

  return containers;
};

export default useUnstatedContainers;
