import fs from 'node:fs';
import path from 'node:path';

import type { GrowiTemplatePluginValidationData } from '../../../../model';
import {
  isTemplateStatusValid,
  type TemplateStatus,
  type TemplateSummary,
} from '../../../interfaces';
import { getStatus } from './get-status';
import { validateTemplatePluginGrowiDirective } from './validate-growi-plugin-directive';

export const scanTemplate = async (
  projectDirRoot: string,
  templateId: string,
  data: GrowiTemplatePluginValidationData,
  opts?: {
    pluginId?: string;
  },
): Promise<TemplateStatus[]> => {
  const status: TemplateStatus[] = [];

  const tplRootDirPath = path.resolve(projectDirRoot, 'dist', templateId);

  let isDefaultPushed = false;
  for await (const locale of data.supportingLocales) {
    const tplDir = path.resolve(tplRootDirPath, locale);

    try {
      const stats = await getStatus(tplDir);
      const { isTemplateExists, meta } = stats;

      if (!isTemplateExists) throw new Error("'template.md does not exist.");
      if (meta == null) throw new Error("'meta.md does not exist.");
      if (meta?.title == null)
        throw new Error("'meta.md does not contain the title.");

      const isDefault = !isDefaultPushed;
      status.push({
        pluginId: opts?.pluginId,
        id: templateId,
        locale,
        isValid: true,
        isDefault,
        title: meta.title,
        desc: meta.desc,
      });
      isDefaultPushed = true;
    } catch (err) {
      status.push({
        pluginId: opts?.pluginId,
        id: templateId,
        locale,
        isValid: false,
        invalidReason: (err as Error).message,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.debug(`Template directory (${projectDirRoot}) has scanned`, {
    status,
  });

  return status;
};

export const scanAllTemplates = async (
  projectDirRoot: string,
  opts?: {
    data?: GrowiTemplatePluginValidationData;
    pluginId?: string;
    returnsInvalidTemplates?: boolean;
  },
): Promise<TemplateSummary[]> => {
  const data =
    opts?.data ?? validateTemplatePluginGrowiDirective(projectDirRoot);

  const summaries: TemplateSummary[] = [];

  const distDirPath = path.resolve(projectDirRoot, 'dist');
  const distDirFiles = fs.readdirSync(distDirPath);

  for await (const templateId of distDirFiles) {
    const status = (
      await scanTemplate(projectDirRoot, templateId, data, {
        pluginId: opts?.pluginId,
      })
    )
      // omit invalid templates if `returnsInvalidTemplates` is true
      .filter((s) => (opts?.returnsInvalidTemplates ? true : s.isValid));

    // determine default locale
    const defaultTemplateStatus = status.find(
      (s) => 'isDefault' in s && s.isDefault,
    );

    if (
      defaultTemplateStatus == null ||
      !isTemplateStatusValid(defaultTemplateStatus)
    ) {
      continue;
    }

    summaries.push({
      // for the 'default' key
      default: defaultTemplateStatus,
      // for each locale keys
      ...Object.fromEntries(
        status.map((templateStatus) => [templateStatus.locale, templateStatus]),
      ),
    });
  }

  return summaries;
};
