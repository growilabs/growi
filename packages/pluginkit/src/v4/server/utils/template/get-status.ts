import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const statAsync = promisify(fs.stat);

type TemplateDirStatus = {
  isTemplateExists: boolean;
  meta?: { [key: string]: string };
};

export async function getStatus(tplDir: string): Promise<TemplateDirStatus> {
  const markdownPath = path.resolve(tplDir, 'template.md');
  const statForMarkdown = await statAsync(markdownPath);
  const isTemplateExists = statForMarkdown.isFile();

  const metaDataPath = path.resolve(tplDir, 'meta.json');
  const statForMetaDataFile = await statAsync(metaDataPath);
  const isMetaDataFileExists = statForMetaDataFile.isFile();

  const result: TemplateDirStatus = {
    isTemplateExists,
    meta: isMetaDataFileExists
      ? JSON.parse(readFileSync(metaDataPath, 'utf-8'))
      : undefined,
  };

  return result;
}
