import type { IFilterXSSOptions } from 'xss';
import { FilterXSS } from 'xss';

const REPETITIONS_NUM = 50;

const option: IFilterXSSOptions = {
  stripIgnoreTag: true,
  stripIgnoreTagBody: false, // see https://github.com/growilabs/growi/pull/505
  css: false,
  escapeHtml: (html) => { return html }, // resolve https://github.com/growilabs/growi/issues/221
};

class GeneralXssFilter extends FilterXSS {

  override process(document: string | undefined): string {
    let count = 0;
    let currDoc = document;
    let prevDoc = document;

    do {
      count += 1;
      // stop running infinitely
      if (count > REPETITIONS_NUM) {
        return '--filtered--';
      }

      prevDoc = currDoc;
      currDoc = super.process(currDoc ?? '');
    }
    while (currDoc !== prevDoc);

    return currDoc;
  }

}

export const generalXssFilter = new GeneralXssFilter(option);
