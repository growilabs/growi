/* eslint-disable max-len */

import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import { PrismAsyncLight } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

export const Cheatsheet = (): JSX.Element => {
  const { t } = useTranslation();

  /*
  * Each Element
  */
  // Left Side
  const codeStr = `# ${t('sandbox.header_x', { index: '1' })}\n## ${t('sandbox.header_x', { index: '2' })}\n### ${t('sandbox.header_x', { index: '3' })}`;
  const codeBlockStr = 'text\n\ntext';
  const lineBlockStr = 'text\ntext';
  const typographyStr = `*${t('sandbox.italics')}*\n**${t('sandbox.bold')}**\n***${t('sandbox.italic_bold')}***\n~~${t('sandbox.strikethrough')}~~`;
  const linkStr = '[Google](https://www.google.co.jp/)';
  const codeHighlightStr = '```javascript:index.js\nwriteCode();\n```';

  // Right Side
  const codeListStr = `- ${t('sandbox.unordered_list_x', { index: '1' })}
    - ${t('sandbox.unordered_list_x', { index: '1.1' })}
    - ${t('sandbox.unordered_list_x', { index: '1.2' })}`;
  const orderedListStr = `1. ${t('sandbox.ordered_list_x', { index: '1' })}\n1. ${t('sandbox.ordered_list_x', { index: '2' })}`;
  const taskStr = `- [ ] ${t('sandbox.task')}(${t('sandbox.task_unchecked')})\n- [x] ${t('sandbox.task')}(${t('sandbox.task_checked')})`;
  const quoteStr = `> ${t('sandbox.quote1')}\n> ${t('sandbox.quote2')}`;
  const nestedQuoteStr = `>> ${t('sandbox.quote_nested')}\n>>> ${t('sandbox.quote_nested')}\n>>>> ${t('sandbox.quote_nested')}`;
  const tableStr = '|Left       |    Mid    |      Right|\n|:----------|:---------:|----------:|\n|col 1      |   col 2   |      col 3|\n|col 1      |   col 2   |      col 3|';
  const imageStr = '![ex](https://example.com/image.png)';


  const renderCheetSheetElm = (CheetSheetElm: string) => {
    return (
      <PrismAsyncLight
        className="code-highlighted"
        PreTag="div"
        style={oneDark}
        language="text"
      >
        {String(CheetSheetElm).replace(/\n$/, '')}
      </PrismAsyncLight>
    );
  };


  return (
    <div className="row small">
      <div className="col-sm-6">

        {/* Header */}
        <h4>{t('sandbox.header')}</h4>
        {renderCheetSheetElm(codeStr)}

        {/* Block */}
        <h4>{t('sandbox.block')}</h4>
        <p className="mb-1"><code>[{t('sandbox.empty_line')}]</code>{t('sandbox.block_detail')}</p>
        {renderCheetSheetElm(codeBlockStr)}

        {/* Line Break */}
        <h4>{t('sandbox.line_break')}</h4>
        <p className="mb-1"><code>[ ][ ]</code> {t('sandbox.line_break_detail')}</p>
        {renderCheetSheetElm(lineBlockStr)}


        {/* Typography */}
        <h4>{t('sandbox.typography')}</h4>
        {renderCheetSheetElm(typographyStr)}

        {/* Link */}
        <h4>{t('sandbox.link')}</h4>
        {renderCheetSheetElm(linkStr)}

        {/* CodeHhighlight */}
        <h4>{t('sandbox.code_highlight')}</h4>
        {renderCheetSheetElm(codeHighlightStr)}
      </div>

      <div className="col-sm-6">
        {/* List */}
        <h4>{t('sandbox.list')}</h4>
        {renderCheetSheetElm(codeListStr)}

        {renderCheetSheetElm(orderedListStr)}

        {renderCheetSheetElm(taskStr)}

        {/* Quote */}
        <h4>{t('sandbox.quote')}</h4>
        {renderCheetSheetElm(quoteStr)}

        {renderCheetSheetElm(nestedQuoteStr)}


        {/* Table */}
        <h4>{t('sandbox.table')}</h4>
        {renderCheetSheetElm(tableStr)}

        {/* Image */}
        <h4>{t('sandbox.image')}</h4>
        <p className="mb-1"><code> ![{t('sandbox.alt_text')}](URL)</code> {t('sandbox.insert_image')}</p>
        {renderCheetSheetElm(imageStr)}

        <hr />
        <a href="/Sandbox" className="btn btn-info" target="_blank">
          <span className="growi-custom-icons">external_link</span> {t('sandbox.open_sandbox')}
        </a>
      </div>
    </div>
  );

};
