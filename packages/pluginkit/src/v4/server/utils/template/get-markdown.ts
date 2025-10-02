import fs from 'node:fs';
import path from 'node:path';

import { getStatus } from './get-status';

export const getMarkdown = async (
  projectDirRoot: string,
  templateId: string,
  locale: string,
): Promise<string> => {
  const tplDir = path.resolve(projectDirRoot, 'dist', templateId, locale);

  const { isTemplateExists } = await getStatus(tplDir);

  if (!isTemplateExists) throw new Error("'template.md does not exist.");

  const markdownPath = path.resolve(tplDir, 'template.md');
  return fs.readFileSync(markdownPath, { encoding: 'utf-8' });
};
