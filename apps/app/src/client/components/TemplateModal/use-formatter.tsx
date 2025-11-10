import path from 'path';

import { format as dateFnsFormat } from 'date-fns/format';
import mustache from 'mustache';

import { useCurrentPagePath } from '~/states/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:components:TemplateModal:use-formatter');


type FormatMethod = (markdown?: string) => string;
type FormatterData = {
  format: FormatMethod,
}

export const useFormatter = (): FormatterData => {
  const currentPagePath = useCurrentPagePath();

  const format: FormatMethod = (markdown) => {
    if (markdown == null) {
      return '';
    }

    // replace placeholder
    const now = new Date();
    try {
      return mustache.render(markdown, {
        title: path.basename(currentPagePath ?? '/'),
        path: currentPagePath ?? '/',
        yyyy: dateFnsFormat(now, 'yyyy'),
        MM: dateFnsFormat(now, 'MM'),
        dd: dateFnsFormat(now, 'dd'),
        HH: dateFnsFormat(now, 'HH'),
        mm: dateFnsFormat(now, 'mm'),
      });
    }
    catch (err) {
      logger.warn('An error occured while ejs processing.', err);
      return markdown;
    }
  };

  return { format };
};
