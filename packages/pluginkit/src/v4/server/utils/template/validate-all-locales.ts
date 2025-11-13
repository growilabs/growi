import { scanAllTemplates } from './scan';
import { validateTemplatePluginGrowiDirective } from './validate-growi-plugin-directive';

export const validateAllTemplateLocales = async (
  projectDirRoot: string,
): Promise<boolean> => {
  const data = validateTemplatePluginGrowiDirective(projectDirRoot);

  const results = await scanAllTemplates(projectDirRoot, {
    data,
    returnsInvalidTemplates: true,
  });

  if (Object.keys(results).length === 0) {
    throw new Error('This plugin does not have any templates');
  }

  // construct map
  // key: id
  // value: isValid properties
  const idValidMap: { [id: string]: boolean[] } = {};
  for (const summary of results) {
    idValidMap[summary.default.id] = Object.values(summary).map(
      (s) => s?.isValid ?? false,
    );
  }

  for (const [id, validMap] of Object.entries(idValidMap)) {
    // warn
    if (!validMap.every((bool) => bool)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[WARN] Template '${id}' has some locales that status is invalid`,
      );
    }

    // This means the template directory does not have any valid template
    if (!validMap.some((bool) => bool)) {
      return false;
    }
  }

  return true;
};
