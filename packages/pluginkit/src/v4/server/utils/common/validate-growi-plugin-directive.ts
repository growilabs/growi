import type { GrowiPluginType } from '@growi/core';

import {
  type GrowiPluginValidationData,
  GrowiPluginValidationError,
} from '../../../../model';
import { importPackageJson } from './import-package-json';

export const validateGrowiDirective = (
  projectDirRoot: string,
  expectedPluginType?: GrowiPluginType,
): GrowiPluginValidationData => {
  const pkg = importPackageJson(projectDirRoot);

  const { growiPlugin } = pkg;

  const data: GrowiPluginValidationData = {
    projectDirRoot,
    schemaVersion: Number.NaN,
    growiPlugin,
  };

  if (growiPlugin == null) {
    throw new GrowiPluginValidationError(
      "The package.json does not have 'growiPlugin' directive.",
      data,
    );
  }

  // schema version checking
  const schemaVersion = Number(growiPlugin.schemaVersion);
  data.schemaVersion = schemaVersion;
  if (Number.isNaN(schemaVersion) || schemaVersion < 4) {
    throw new GrowiPluginValidationError(
      "The growiPlugin directive must have a valid 'schemaVersion' directive.",
      data,
    );
  }

  const types: GrowiPluginType[] = growiPlugin.types;
  data.actualPluginTypes = types;
  if (types == null) {
    throw new GrowiPluginValidationError(
      "The growiPlugin directive does not have 'types' directive.",
      data,
    );
  }

  // type checking
  if (expectedPluginType != null) {
    data.expectedPluginType = expectedPluginType;

    if (!types.includes(expectedPluginType)) {
      throw new GrowiPluginValidationError(
        "The growiPlugin directive does not have expected plugin type in 'types' directive.",
        data,
      );
    }
  }

  return data;
};
