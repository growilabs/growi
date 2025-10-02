import { GrowiPluginType } from '@growi/core';

import type {
  GrowiPluginValidationData,
  GrowiTemplatePluginValidationData,
} from '../../../../model';
import { GrowiPluginValidationError } from '../../../../model';
import { validateGrowiDirective } from '../common';

/**
 * An utility for template plugin which wrap 'validateGrowiDirective' of './common' module
 * @param projectDirRoot
 */
export const validateTemplatePluginGrowiDirective = (
  projectDirRoot: string,
): GrowiTemplatePluginValidationData => {
  const data = validateGrowiDirective(projectDirRoot, GrowiPluginType.Template);

  const { growiPlugin } = data;

  // check supporting locales
  const supportingLocales: string[] | undefined = growiPlugin.locales;
  if (supportingLocales == null || supportingLocales.length === 0) {
    throw new GrowiPluginValidationError<
      GrowiPluginValidationData & { supportingLocales?: string[] }
    >(
      "Template plugin must have 'supportingLocales' and that must have one or more locales",
      {
        ...data,
        supportingLocales,
      },
    );
  }

  return {
    ...data,
    supportingLocales,
  };
};
