import MarkdownIt from 'markdown-it';

import loggerFactory from '~/utils/logger';

import CsvToTable from './PreProcessor/CsvToTable';
import EasyGrid from './PreProcessor/EasyGrid';
import Linker from './PreProcessor/Linker';
import XssFilter from './PreProcessor/XssFilter';
import BlockdiagConfigurer from './markdown-it/blockdiag';
import DrawioViewerConfigurer from './markdown-it/drawio-viewer';
import EmojiConfigurer from './markdown-it/emoji';
import FooternoteConfigurer from './markdown-it/footernote';
import HeaderConfigurer from './markdown-it/header';
import HeaderLineNumberConfigurer from './markdown-it/header-line-number';
import HeaderWithEditLinkConfigurer from './markdown-it/header-with-edit-link';
import LinkerByRelativePathConfigurer from './markdown-it/link-by-relative-path';
import MathJaxConfigurer from './markdown-it/mathjax';
import PlantUMLConfigurer from './markdown-it/plantuml';
import TableConfigurer from './markdown-it/table';
import TableWithHandsontableButtonConfigurer from './markdown-it/table-with-handsontable-button';
import TaskListsConfigurer from './markdown-it/task-lists';
import TocAndAnchorConfigurer from './markdown-it/toc-and-anchor';

const logger = loggerFactory('growi:util:GrowiRenderer');

export default class GrowiRenderer {

  /**
   *
   * @param {AppContainer} appContainer
   * @param {GrowiRenderer} originRenderer
   * @param {string} mode
   */
  constructor(appContainer, originRenderer) {
    this.appContainer = appContainer;

    if (originRenderer != null) {
      this.preProcessors = originRenderer.preProcessors;
      this.postProcessors = originRenderer.postProcessors;
    }
    else {
      this.preProcessors = [
        new EasyGrid(),
        new Linker(),
        new CsvToTable(),
        new XssFilter(appContainer),
      ];
      this.postProcessors = [
      ];
    }

    this.initMarkdownItConfigurers = this.initMarkdownItConfigurers.bind(this);
    this.setup = this.setup.bind(this);
    this.process = this.process.bind(this);
    this.codeRenderer = this.codeRenderer.bind(this);
  }

  initMarkdownItConfigurers(mode) {
    const appContainer = this.appContainer;

    // init markdown-it
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      highlight: this.codeRenderer,
    });

    this.isMarkdownItConfigured = false;

    this.markdownItConfigurers = [
      new LinkerByRelativePathConfigurer(appContainer),
      new TaskListsConfigurer(appContainer),
      new HeaderConfigurer(),
      new EmojiConfigurer(),
      new MathJaxConfigurer(appContainer),
      new DrawioViewerConfigurer(),
      new PlantUMLConfigurer(appContainer),
      new BlockdiagConfigurer(appContainer),
    ];

    // add configurers according to mode
    switch (mode) {
      case 'page': {
        this.markdownItConfigurers = this.markdownItConfigurers.concat([
          new FooternoteConfigurer(),
          new TocAndAnchorConfigurer(),
          new HeaderLineNumberConfigurer(),
          new HeaderWithEditLinkConfigurer(),
          new TableWithHandsontableButtonConfigurer(),
        ]);
        break;
      }
      case 'editor':
        this.markdownItConfigurers = this.markdownItConfigurers.concat([
          new FooternoteConfigurer(),
          new HeaderLineNumberConfigurer(),
          new TableConfigurer(),
        ]);
        break;
      // case 'comment':
      //   break;
      default:
        this.markdownItConfigurers = this.markdownItConfigurers.concat([
          new TableConfigurer(),
        ]);
        break;
    }

    // function parse(src) {
    //   if (src.starsWith('(/attachment/')) {
    //     // const innerText = src.slice(1, src.length - 1);
    //     return {
    //       type: 'attachment',
    //       src,
    //     };
    //   }
    //   return {
    //     type: 'text',
    //     src,
    //   };
    // }

    // function parseNotation(text) {
    //   const result = [''];
    //   for (const char of text) {
    //     switch (char) {
    //       case '(':
    //         result.push(char);
    //         break;
    //       case ')':
    //         result[result.length - 1] += char;
    //         result.push('');
    //         break;
    //       default:
    //         result[result.length - 1] += char;
    //         break;
    //     }
    //   }
    //   return result.filter(Boolean).map(parse);
    // }

    this.md.inline.ruler.after('text', 'my_rule', (state) => {

    });

    this.md.renderer.rules.my_rule = (tokens, idx) => {
      return '<p>this is test text.</p>';
    };

    // this.md.inline.ruler.push('grw_attachment_rule', (state) => {
    //   const parsed = parseNotation(state.src);
    //   if (parsed.filter(item => item.type === 'attachment').length >= 1) {
    //     state.tokens[0].type = 'grw_attachment_link';
    //   }
    //   return false;
    // });
    // this.md.renderer.rules.grw_attachment_link = (tokens, idx) => {
    //   const token = tokens[idx];
    //   const parsed = parseNotation(token.content);
    //   return parsed.map(render).join('');
    // };
  }

  /**
   * setup with crowi config
   */
  setup(mode) {
    const crowiConfig = this.appContainer.config;

    let isEnabledLinebreaks;
    switch (mode) {
      case 'comment':
        isEnabledLinebreaks = crowiConfig.isEnabledLinebreaksInComments;
        break;
      default:
        isEnabledLinebreaks = crowiConfig.isEnabledLinebreaks;
        break;
    }

    this.md.set({
      breaks: isEnabledLinebreaks,
    });

    if (!this.isMarkdownItConfigured) {
      this.markdownItConfigurers.forEach((configurer) => {
        configurer.configure(this.md);
      });
    }
  }

  preProcess(markdown, context) {
    let processed = markdown;
    for (let i = 0; i < this.preProcessors.length; i++) {
      if (!this.preProcessors[i].process) {
        continue;
      }
      processed = this.preProcessors[i].process(processed, context);
    }

    return processed;
  }

  process(markdown, context) {
    return this.md.render(markdown, context);
  }

  postProcess(html, context) {
    let processed = html;
    for (let i = 0; i < this.postProcessors.length; i++) {
      if (!this.postProcessors[i].process) {
        continue;
      }
      processed = this.postProcessors[i].process(processed, context);
    }

    return processed;
  }

  codeRenderer(code, langExt) {
    const config = this.appContainer.getConfig();
    const noborder = (!config.highlightJsStyleBorder) ? 'hljs-no-border' : '';

    let citeTag = '';
    let hljsLang = 'plaintext';
    let showLinenumbers = false;

    if (langExt) {
      // https://regex101.com/r/qGs7eZ/3
      const match = langExt.match(/^([^:=\n]+)?(=([^:=\n]*))?(:([^:=\n]*))?(=([^:=\n]*))?$/);

      const lang = match[1];
      const fileName = match[5] || null;
      showLinenumbers = (match[2] != null) || (match[6] != null);

      if (fileName != null) {
        citeTag = `<cite>${fileName}</cite>`;
      }
      if (hljs.getLanguage(lang)) {
        hljsLang = lang;
      }
    }

    let highlightCode = code;
    try {
      highlightCode = hljs.highlight(hljsLang, code, true).value;

      // add line numbers
      if (showLinenumbers) {
        highlightCode = hljs.lineNumbersValue((highlightCode));
      }
    }
    catch (err) {
      logger.error(err);
    }

    return `<pre class="hljs ${noborder}">${citeTag}<code>${highlightCode}</code></pre>`;
  }

  highlightCode(code, lang) {
  }

}
