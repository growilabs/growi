import csvToMarkdown from 'csv-to-markdown-table';
import { markdownTable } from 'markdown-table';
import stringWidth from 'string-width';

// https://github.com/markdown-it/markdown-it/blob/d29f421927e93e88daf75f22089a3e732e195bd2/lib/rules_block/table.js#L83
// https://regex101.com/r/7BN2fR/7
const tableAlignmentLineRE = /^[-:|][-:|\s]*$/;
const tableAlignmentLineNegRE = /^[^-:]*$/; // it is need to check to ignore empty row which is matched above RE
const linePartOfTableRE = /^\|[^\r\n]*|[^\r\n]*\|$|([^|\r\n]+\|[^|\r\n]*)+/; // own idea

const defaultOptions = { stringLength: stringWidth };

/**
 * markdown table class for markdown-table module
 *   ref. https://github.com/wooorm/markdown-table
 */
export class MarkdownTable {
  constructor(table, options) {
    this.table = table || [];
    this.options = Object.assign(options || {}, defaultOptions);

    this.toString = this.toString.bind(this);
  }

  toString() {
    return markdownTable(this.table, this.options);
  }

  /**
   * returns cloned Markdowntable instance
   * (This method clones only the table field.)
   */
  clone() {
    const newTable = [];
    for (let i = 0; i < this.table.length; i++) {
      newTable.push([].concat(this.table[i]));
    }
    return new MarkdownTable(newTable, this.options);
  }

  /**
   * normalize all cell data(trim & convert the newline character to space or pad '' if cell data is null)
   */
  normalizeCells() {
    for (let i = 0; i < this.table.length; i++) {
      for (let j = 0; j < this.table[i].length; j++) {
        if (this.table[i][j] != null) {
          this.table[i][j] = this.table[i][j].trim().replace(/\r?\n/g, ' ');
        } else {
          this.table[i][j] = '';
        }
      }
    }

    return this;
  }

  /**
   * return a MarkdownTable instance made from a string of HTML table tag
   *
   * If a parser error occurs, an error object with an error message is thrown.
   * The error message is a innerHTML, so must not assign it into element.innerHTML because it can lead to Mutation-based XSS
   */
  static fromHTMLTableTag(str) {
    // set up DOMParser
    const domParser = new window.DOMParser();

    // use DOMParser to prevent DOM based XSS (https://developer.mozilla.org/en-US/docs/Web/API/DOMParser)
    const dom = domParser.parseFromString(str, 'application/xml');

    if (dom.querySelector('parsererror')) {
      throw new Error(dom.documentElement.innerHTML);
    }

    const tableElement = dom.querySelector('table');
    const trElements = tableElement.querySelectorAll('tr');

    const table = [];
    let maxRowSize = 0;
    for (let i = 0; i < trElements.length; i++) {
      const row = [];
      const cellElements = trElements[i].querySelectorAll('th,td');
      for (let j = 0; j < cellElements.length; j++) {
        row.push(cellElements[j].innerHTML);
      }
      table.push(row);

      if (maxRowSize < row.length) maxRowSize = row.length;
    }

    const align = [];
    for (let i = 0; i < maxRowSize; i++) {
      align.push('');
    }

    return new MarkdownTable(table, { align });
  }

  /**
   * return a MarkdownTable instance made from a string of delimiter-separated values
   */
  static fromDSV(str, delimiter) {
    return MarkdownTable.fromMarkdownString(
      csvToMarkdown(str, delimiter, true),
    );
  }

  /**
   * return a MarkdownTable instance
   *   ref. https://github.com/wooorm/markdown-table
   * @param {string} str markdown string
   */
  static fromMarkdownString(str) {
    const arrMDTableLines = str.split(/(\r\n|\r|\n)/);
    const contents = [];
    let aligns = [];
    for (let n = 0; n < arrMDTableLines.length; n++) {
      const line = arrMDTableLines[n];

      if (
        tableAlignmentLineRE.test(line) &&
        !tableAlignmentLineNegRE.test(line)
      ) {
        // parse line which described alignment
        const alignRuleRE = [
          { align: 'c', regex: /^:-+:$/ },
          { align: 'l', regex: /^:-+$/ },
          { align: 'r', regex: /^-+:$/ },
        ];
        let lineText = '';
        lineText = line.replace(/^\||\|$/g, ''); // strip off pipe charactor which is placed head of line and last of line.
        lineText = lineText.replace(/\s*/g, '');
        aligns = lineText.split(/\|/).map((col) => {
          const rule = alignRuleRE.find((rule) => {
            return col.match(rule.regex);
          });
          return rule != null ? rule.align : '';
        });
      } else if (linePartOfTableRE.test(line)) {
        // parse line whether header or body
        let lineText = '';
        lineText = line.replace(/\s*\|\s*/g, '|');
        lineText = lineText.replace(/^\||\|$/g, ''); // strip off pipe charactor which is placed head of line and last of line.
        const row = lineText.split(/\|/);
        contents.push(row);
      }
    }
    return new MarkdownTable(contents, { align: aligns });
  }
}
