import { useMemo } from 'react';
import type { FeatureImplementation } from '@headless-tree/core';
import {
  asyncDataLoaderFeature,
  checkboxesFeature,
  dragAndDropFeature,
  hotkeysCoreFeature,
  renamingFeature,
  selectionFeature,
} from '@headless-tree/core';

import type { UsePageDndProperties } from '../use-page-dnd';
import { usePageDnd } from '../use-page-dnd';
import type { UseCheckboxProperties } from './use-checkbox';
import { useCheckbox } from './use-checkbox';

export type UseTreeFeaturesOptions = {
  enableRenaming?: boolean;
  enableCheckboxes?: boolean;
  enableDragAndDrop?: boolean;
  initialCheckedItems?: string[];
};

export type UseTreeFeaturesResult = {
  features: FeatureImplementation<unknown>[];
  checkboxProperties: UseCheckboxProperties;
  dndProperties: UsePageDndProperties;
};

/**
 * Hook to configure tree features based on options.
 * Returns a stable array of features for use with headless-tree,
 * along with checkbox state and page D&D handlers.
 */
export const useTreeFeatures = (
  options: UseTreeFeaturesOptions = {},
): UseTreeFeaturesResult => {
  const {
    enableRenaming = true,
    enableCheckboxes = false,
    enableDragAndDrop = false,
    initialCheckedItems = [],
  } = options;

  // Get checkbox properties
  const checkboxProperties = useCheckbox({
    enabled: enableCheckboxes,
    initialCheckedItems,
  });

  // Get page D&D handlers
  const dndProperties = usePageDnd(enableDragAndDrop);

  const features = useMemo(() => {
    const featureList: FeatureImplementation<unknown>[] = [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
    ];

    if (enableRenaming) {
      featureList.push(renamingFeature);
    }

    if (enableCheckboxes) {
      featureList.push(checkboxesFeature);
    }

    if (enableDragAndDrop) {
      featureList.push(dragAndDropFeature);
    }

    return featureList;
  }, [enableRenaming, enableCheckboxes, enableDragAndDrop]);

  return useMemo(
    () => ({
      features,
      checkboxProperties,
      dndProperties,
    }),
    [features, checkboxProperties, dndProperties],
  );
};
