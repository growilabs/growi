import ExtensibleCustomError from 'extensible-custom-error';

import type { GrowiPluginValidationData } from './growi-plugin-validation-data';

export class GrowiPluginValidationError<
  E extends
    Partial<GrowiPluginValidationData> = Partial<GrowiPluginValidationData>,
> extends ExtensibleCustomError {
  data?: E;

  constructor(message: string, data?: E) {
    super(message);
    this.data = data;
  }
}
