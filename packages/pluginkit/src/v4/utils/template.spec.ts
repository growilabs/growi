import type { TemplateSummary } from '../interfaces';
import { extractSupportedLocales, getLocalizedTemplate } from './template';

describe('getLocalizedTemplate', () => {
  it('should return undefined if templateSummary is undefined', () => {
    expect(getLocalizedTemplate(undefined)).toBeUndefined();
  });

  it('should return the default template if locale is not provided', () => {
    const templateSummary: TemplateSummary = {
      default: {
        id: 'templateId',
        locale: 'en_US',
        isValid: true,
        isDefault: true,
        title: 'Default Title',
      },
    };
    expect(getLocalizedTemplate(templateSummary)).toEqual(
      templateSummary.default,
    );
  });

  it('should return the localized template if locale is provided and exists in templateSummary', () => {
    const templateSummary: TemplateSummary = {
      default: {
        id: 'templateId',
        locale: 'en_US',
        isValid: true,
        isDefault: true,
        title: 'Default Title',
      },
      ja_JP: {
        id: 'templateId',
        locale: 'ja_JP',
        isValid: true,
        isDefault: false,
        title: 'Japanese Title',
      },
    };
    expect(getLocalizedTemplate(templateSummary, 'ja_JP')).toEqual(
      templateSummary.ja_JP,
    );
  });

  it('should return the default template if locale is provided but does not exist in templateSummary', () => {
    const templateSummary: TemplateSummary = {
      default: {
        id: 'templateId',
        locale: 'en_US',
        isValid: true,
        isDefault: true,
        title: 'Default Title',
      },
    };
    expect(getLocalizedTemplate(templateSummary, 'fr')).toEqual(
      templateSummary.default,
    );
  });
});

describe('extractSupportedLocales', () => {
  it('should return undefined if templateSummary is undefined', () => {
    expect(extractSupportedLocales(undefined)).toBeUndefined();
  });

  it('should return a set of locales from the templateSummary', () => {
    const templateSummary: TemplateSummary = {
      default: {
        id: 'templateId',
        locale: 'en_US',
        isValid: true,
        isDefault: true,
        title: 'Default Title',
      },
      ja_JP: {
        id: 'templateId',
        locale: 'ja_JP',
        isValid: true,
        isDefault: false,
        title: 'Japanese Title',
      },
    };
    expect(extractSupportedLocales(templateSummary)).toEqual(
      new Set(['en_US', 'ja_JP']),
    );
  });
});
