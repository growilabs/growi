import {
  getLocalizedTemplate,
  type TemplateSummary,
} from '@growi/pluginkit/dist/v4';
import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';

import { apiv3Get } from '~/client/util/apiv3-client';

export const useSWRxTemplates = (): SWRResponse<TemplateSummary[], Error> => {
  return useSWRImmutable('/templates', (endpoint) =>
    apiv3Get<{ summaries: TemplateSummary[] }>(endpoint).then(
      (res) => res.data.summaries,
    ),
  );
};

export const useSWRxTemplate = (
  summary: TemplateSummary | undefined,
  locale?: string,
): SWRResponse<string, Error> => {
  const pluginId = summary?.default.pluginId;
  const targetTemplate = getLocalizedTemplate(summary, locale);

  return useSWRImmutable(
    () => {
      if (targetTemplate == null) {
        return null;
      }

      return pluginId == null
        ? `/templates/preset-templates/${targetTemplate.id}/${targetTemplate.locale}`
        : `/templates/plugin-templates/${pluginId}/${targetTemplate.id}/${targetTemplate.locale}`;
    },
    (endpoint) =>
      apiv3Get<{ markdown: string }>(endpoint).then((res) => res.data.markdown),
  );
};
