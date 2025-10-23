import { encodeSpaces } from '@growi/core/dist/utils/page-path-utils';

export class Linker {
  type: string;

  label: string | undefined;

  link: string | undefined;

  constructor(type = Linker.types.markdownLink, label = '', link = '') {
    this.type = type;
    this.label = label;
    this.link = link;

    if (type === Linker.types.markdownLink) {
      this.initWhenMarkdownLink();
    }

    this.generateMarkdownText = this.generateMarkdownText.bind(this);
  }

  static types = {
    markdownLink: 'mdLink',
    growiLink: 'growiLink',
    pukiwikiLink: 'pukiwikiLink',
  };

  static patterns = {
    pukiwikiLinkWithLabel: /^\[\[(?<label>.+)>(?<link>.+)\]\]$/, // https://regex101.com/r/2fNmUN/2
    pukiwikiLinkWithoutLabel: /^\[\[(?<label>.+)\]\]$/, // https://regex101.com/r/S7w5Xu/1
    growiLink: /^\[(?<label>\/.+)\]$/, // https://regex101.com/r/DJfkYf/3
    markdownLink: /^\[(?<label>.*)\]\((?<link>.*)\)$/, // https://regex101.com/r/DZCKP3/2
  };

  initWhenMarkdownLink(): void {
    // fill label with link if empty
    if (this.label === '') {
      this.label = this.link;
    }
    // encode spaces
    this.link = encodeSpaces(this.link);
  }

  generateMarkdownText(): string | undefined {
    if (this.type === Linker.types.pukiwikiLink) {
      if (this.label === '') return `[[${this.link}]]`;
      return `[[${this.label}>${this.link}]]`;
    }
    if (this.type === Linker.types.growiLink) {
      return `[${this.link}]`;
    }
    if (this.type === Linker.types.markdownLink) {
      return `[${this.label}](${this.link})`;
    }
  }

  // create an instance of Linker from string
  static fromMarkdownString(str: string): Linker {
    // if str doesn't mean a linker, create a link whose label is str
    let label = str;
    let link = '';
    let type = Linker.types.markdownLink;

    // pukiwiki with separator ">".
    if (str.match(Linker.patterns.pukiwikiLinkWithLabel)) {
      type = Linker.types.pukiwikiLink;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ({ label, link } = str.match(Linker.patterns.pukiwikiLinkWithLabel)!
        .groups!);
    }
    // pukiwiki without separator ">".
    else if (str.match(Linker.patterns.pukiwikiLinkWithoutLabel)) {
      type = Linker.types.pukiwikiLink;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ({ label } = str.match(Linker.patterns.pukiwikiLinkWithoutLabel)!
        .groups!);
      link = label;
    }
    // markdown
    else if (str.match(Linker.patterns.markdownLink)) {
      type = Linker.types.markdownLink;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ({ label, link } = str.match(Linker.patterns.markdownLink)!.groups!);
    }
    // growi
    else if (str.match(Linker.patterns.growiLink)) {
      type = Linker.types.growiLink;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ({ label } = str.match(Linker.patterns.growiLink)!.groups!);
      link = label;
    }

    return new Linker(type, label, link);
  }

  // create an instance of Linker from text with index
  static fromLineWithIndex(line: string, index: number): Linker {
    const { beginningOfLink, endOfLink } = Linker.getBeginningAndEndIndexOfLink(
      line,
      index,
    );
    // if index is in a link, extract it from line
    let linkStr = '';
    if (beginningOfLink >= 0 && endOfLink >= 0) {
      linkStr = line.substring(beginningOfLink, endOfLink);
    }
    return Linker.fromMarkdownString(linkStr);
  }

  // return beginning and end indices of link
  // if index is not in a link, return { beginningOfLink: -1, endOfLink: -1 }
  static getBeginningAndEndIndexOfLink(
    line: string,
    index: number,
  ): { beginningOfLink: number; endOfLink: number } {
    let beginningOfLink: number;
    let endOfLink: number;

    // pukiwiki link ('[[link]]')
    [beginningOfLink, endOfLink] =
      Linker.getBeginningAndEndIndexWithPrefixAndSuffix(
        line,
        index,
        '[[',
        ']]',
      );

    // markdown link ('[label](link)')
    if (
      beginningOfLink < 0 ||
      endOfLink < 0 ||
      beginningOfLink > index ||
      endOfLink < index
    ) {
      [beginningOfLink, endOfLink] =
        Linker.getBeginningAndEndIndexWithPrefixAndSuffix(
          line,
          index,
          '[',
          ')',
          '](',
        );
    }

    // growi link ('[/link]')
    if (
      beginningOfLink < 0 ||
      endOfLink < 0 ||
      beginningOfLink > index ||
      endOfLink < index
    ) {
      [beginningOfLink, endOfLink] =
        Linker.getBeginningAndEndIndexWithPrefixAndSuffix(
          line,
          index,
          '[/',
          ']',
        );
    }

    // return { beginningOfLink: -1, endOfLink: -1 }
    if (
      beginningOfLink < 0 ||
      endOfLink < 0 ||
      beginningOfLink > index ||
      endOfLink < index
    ) {
      [beginningOfLink, endOfLink] = [-1, -1];
    }

    return { beginningOfLink, endOfLink };
  }

  // return begin and end indices as an array only when index is between prefix and suffix and link contains containText.
  static getBeginningAndEndIndexWithPrefixAndSuffix(
    line: string,
    index: number,
    prefix: string,
    suffix: string,
    containText = '',
  ): [number, number] {
    const beginningIndex = line.lastIndexOf(prefix, index);
    const indexOfContainText = line.indexOf(
      containText,
      beginningIndex + prefix.length,
    );
    const endIndex = line.indexOf(
      suffix,
      indexOfContainText + containText.length,
    );

    if (beginningIndex < 0 || indexOfContainText < 0 || endIndex < 0) {
      return [-1, -1];
    }
    return [beginningIndex, endIndex + suffix.length];
  }
}
