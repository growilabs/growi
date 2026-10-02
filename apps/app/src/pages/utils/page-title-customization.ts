import { DevidedPagePath } from '@growi/core/dist/models';

import { useAppTitle, useCustomTitleTemplate } from '~/states/global';

/**
 * Generate whole title string for the specified title
 * @param props
 * @param title
 */
export const useCustomTitle = (title: string): string => {
  const appTitle = useAppTitle();
  const customTitleTemplate = useCustomTitleTemplate();

  return customTitleTemplate
    .replace('{{sitename}}', appTitle)
    .replace('{{pagepath}}', title)
    .replace('{{pagename}}', title);
};

/**
 * Generate whole title string for the specified page path
 * @param props
 * @param pagePath
 */
export const useCustomTitleForPage = (pagePath: string): string => {
  const appTitle = useAppTitle();
  const customTitleTemplate = useCustomTitleTemplate();

  const dPagePath = new DevidedPagePath(pagePath, true, true);

  return customTitleTemplate
    .replace('{{sitename}}', appTitle)
    .replace('{{pagepath}}', pagePath)
    .replace('{{pagename}}', dPagePath.latter);
};
