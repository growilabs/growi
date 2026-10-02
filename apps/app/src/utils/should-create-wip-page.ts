import { checkTemplatePath } from '@growi/core/dist/utils/template-checker';

/**
 * Returns Whether to create pages with the wip flag
 * @param {string|undefined} path
 * @returns {boolean}
 */
export const shouldCreateWipPage = (path?: string): boolean => {
  if (path == null) {
    return true;
  }

  return !(checkTemplatePath(path) || path === '/Sidebar');
};
