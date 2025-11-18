import type { TemplateStatus, TemplateSummary } from '../interfaces';

export const getLocalizedTemplate = (
  templateSummary: TemplateSummary | undefined,
  locale?: string,
): TemplateStatus | undefined => {
  if (templateSummary == null) {
    return undefined;
  }

  return locale != null && locale in templateSummary
    ? templateSummary[locale]
    : templateSummary.default;
};

export const extractSupportedLocales = (
  templateSummary: TemplateSummary | undefined,
): Set<string> | undefined => {
  if (templateSummary == null) {
    return undefined;
  }

  return new Set(Object.values(templateSummary).map((s) => s.locale));
};
