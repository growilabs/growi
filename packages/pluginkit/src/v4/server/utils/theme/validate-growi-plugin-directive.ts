import type { GrowiThemeMetadata } from '@growi/core';
import { GrowiPluginType, isGrowiThemeMetadata } from '@growi/core';

import type {
  GrowiPluginValidationData,
  GrowiThemePluginValidationData,
} from '../../../../model';
import { GrowiPluginValidationError } from '../../../../model';
import { validateGrowiDirective } from '../common';

/**
 * An utility for theme plugin which wrap 'validateGrowiDirective' of './common' module
 * @param projectDirRoot
 */
export const validateThemePluginGrowiDirective = (
  projectDirRoot: string,
): GrowiThemePluginValidationData => {
  const data = validateGrowiDirective(projectDirRoot, GrowiPluginType.Theme);

  const { growiPlugin } = data;

  // check themes
  if (
    growiPlugin.themes == null ||
    !Array.isArray(growiPlugin.themes) ||
    growiPlugin.themes.length === 0
  ) {
    throw new GrowiPluginValidationError<GrowiPluginValidationData>(
      "Theme plugin must have 'themes' array and that must have one or more theme metadata",
    );
  }

  const validMetadatas: GrowiThemeMetadata[] = [];
  const invalidObjects: unknown[] = [];
  for (const theme of growiPlugin.themes) {
    if (isGrowiThemeMetadata(theme)) {
      validMetadatas.push(theme);
    } else {
      invalidObjects.push(theme);
    }
  }

  if (invalidObjects.length > 0) {
    throw new GrowiPluginValidationError<GrowiPluginValidationData>(
      `Some of theme metadata are invalid: ${invalidObjects.toString()}`,
    );
  }

  return {
    ...data,
    themes: validMetadatas,
  };
};
