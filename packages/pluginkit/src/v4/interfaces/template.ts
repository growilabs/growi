export type TemplateStatusBasis = {
  id: string;
  locale: string;
  pluginId?: string;
};
export type TemplateStatusValid = TemplateStatusBasis & {
  isValid: true;
  isDefault: boolean;
  title: string;
  desc?: string;
};
export type TemplateStatusInvalid = TemplateStatusBasis & {
  isValid: false;
  invalidReason: string;
};
export type TemplateStatus = TemplateStatusValid | TemplateStatusInvalid;

export function isTemplateStatusValid(
  status: TemplateStatus,
): status is TemplateStatusValid {
  return status.isValid;
}

export type TemplateSummary = {
  default: TemplateStatusValid;
  [locale: string]: TemplateStatus;
};
