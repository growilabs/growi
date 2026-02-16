import React from 'react';
import { useTranslation } from 'react-i18next';

const GuideRow = ({
  title,
  code,
  preview,
  minWidth = '230px',
  underContent,
}: {
  title: string;
  code: string;
  preview: React.ReactNode;
  minWidth?: string;
  underContent?: React.ReactNode;
}) => {
  const { t } = useTranslation();
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    alert(t('editor_guide.textstyle.copy_done'));
  };

  return (
    <section className={title !== '' ? 'mt-4 mb-2' : 'mb-2'}>
      {title !== '' && (
        <h3
          className="fw-bold mb-2"
          style={{ fontSize: '20px', color: '#223246' }}
        >
          {title}
        </h3>
      )}
      <div className="d-flex flex-row flex-wrap align-items-center gap-4 py-1">
        <div
          onClick={handleCopy}
          style={{ cursor: 'pointer' }}
          className="flex-grow-0 flex-shrink-0"
        >
          <div
            className="bg-dark text-light p-2 ps-3 pe-5 rounded position-relative"
            style={{
              backgroundColor: '#2D2E32',
              minWidth,
              width: 'fit-content',
            }}
          >
            <pre
              className="m-0 small font-monospace"
              style={{ whiteSpace: 'pre', color: '#ccc', lineHeight: '1.5' }}
            >
              {code}
            </pre>
            <small
              className="position-absolute badge bg-secondary opacity-50"
              style={{ fontSize: '0.4rem', top: '4px', right: '4px' }}
            >
              Click
            </small>
          </div>
        </div>
        {preview && (
          <div
            className="flex-grow-1"
            style={{
              minWidth: '250px',
              flexBasis: '0',
            }}
          >
            <div className="wiki-content small">
              {preview}
            </div>
          </div>
        )}
      </div>

      {underContent && (
        <div className="mt-2 w-100">
          {underContent}
        </div>
      )}
    </section>
  );
};

export const LayoutTab: React.FC = () => {
  const { t } = useTranslation();
  const i18nKey = 'editor_guide.layout';

  const LAYOUT_GUIDES = [
    {
      id: 'header',
      title: t(`${i18nKey}.header`),
      code: [
        `# ${t(`${i18nKey}.header_text`)}1`,
        `## ${t(`${i18nKey}.header_text`)}2`,
        `### ${t(`${i18nKey}.header_text`)}3`,
        `#### ${t(`${i18nKey}.header_text`)}4`,
        `##### ${t(`${i18nKey}.header_text`)}5`,
        `###### ${t(`${i18nKey}.header_text`)}6`,
      ].join('\n'),
      preview: (
        <div style={{ color: '#223246', fontFamily: 'Noto Sans CJK JP', lineHeight: '1.5' }}>
          <h1
            className="h2 border-bottom pb-1 mb-2"
            style={{
              color: '#223246',
              fontSize: '30px',
              fontWeight: 400,
              borderBottom: '2px solid #E6E5E3',
            }}
          >
            {t(`${i18nKey}.header_text`)}1
          </h1>
          <h2
            className="border-bottom pb-1 mb-2"
            style={{
              color: '#223246',
              fontFamily: 'Noto Sans CJK JP',
              fontWeight: 700,
              fontSize: '26px',
              lineHeight: '100%',
              borderBottom: '2px solid #E6E5E3',
            }}
          >
            {t(`${i18nKey}.header_text`)}2
          </h2>
          <h3
            className="mb-2"
            style={{
              color: '#223246',
              fontFamily: 'Noto Sans CJK JP',
              fontWeight: 700,
              fontSize: '22px',
              lineHeight: '100%',
              letterSpacing: '0%',
            }}
          >
            {t(`${i18nKey}.header_text`)}3
          </h3>
          <h4
            className="h5 border-start border-4 ps-2 mb-2"
            style={{
              color: '#223246',
              fontSize: '22px',
              borderLeft: '4px solid #E6E5E3',
              fontWeight: 400,
              lineHeight: '100%',
              letterSpacing: '0%',
            }}
          >
            {t(`${i18nKey}.header_text`)}4
          </h4>
          <h5
            className="h6 border-start border-4 ps-2 mb-2"
            style={{
              color: '#223246',
              fontSize: '22px',
              borderLeft: '4px solid #E6E5E3',
              fontWeight: 400,
              lineHeight: '100%',
              letterSpacing: '0%',
            }}
          >
            {t(`${i18nKey}.header_text`)}5
          </h5>
          <h6
            className="small border-start border-4 ps-2 mb-0"
            style={{
              fontSize: '19px',
              borderLeft: '4px solid #E6E5E3',
              color: '#223246',
              fontWeight: 400,
              lineHeight: '100%',
              letterSpacing: '0%',
            }}
          >
            {t(`${i18nKey}.header_text`)}6
          </h6>
        </div>
      ),
    },
    {
      id: 'list',
      title: t(`${i18nKey}.list`),
      code: `- ${t(`${i18nKey}.list_text`)}\n  * ${t(`${i18nKey}.list_text`)}\n    + ${t(`${i18nKey}.list_text`)}`,
      preview: (
        <ul className="mb-0" style={{ listStyleType: 'disc' }}>
          <li>
            {t(`${i18nKey}.list_text`)}
            <ul className="mt-1" style={{ listStyleType: 'disc' }}>
              <li>
                {t(`${i18nKey}.list_text`)}
                <ul className="mt-1" style={{ listStyleType: 'disc' }}>
                  <li>{t(`${i18nKey}.list_text`)}</li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      ),
    },
    {
      id: 'ordered-list',
      title: t(`${i18nKey}.ordered_list`),
      code: `1. ${t(`${i18nKey}.ordered_list_text`)}\n1. ${t(`${i18nKey}.ordered_list_text`)}\n1. ${t(`${i18nKey}.ordered_list_text`)}`,
      preview: (
        <ol className="ps-3 mb-0" style={{ color: '#24292e' }}>
          <li className="mb-2">{t(`${i18nKey}.ordered_list_text`)}</li>
          <li className="mb-2">{t(`${i18nKey}.ordered_list_text`)}</li>
          <li className="mb-0">{t(`${i18nKey}.ordered_list_text`)}</li>
        </ol>
      ),
    },
    {
      id: 'checkbox',
      title: t(`${i18nKey}.checkbox`),
      code: `[x] ${t(`${i18nKey}.task`)}1\n  [] ${t(`${i18nKey}.task`)}1-1\n  [x] ${t(`${i18nKey}.task`)}1-2`,
      preview: (
        <div
          style={{
            color: '#223246',
            fontSize: '16px',
            lineHeight: '27px',
            fontFamily: 'Noto Sans CJK JP'
          }}
        >
          <div className="d-flex align-items-center mb-1">
            <span style={{ fontSize: '16px', marginRight: '10px', userSelect: 'none' }}>☑️</span>
            <span>{t(`${i18nKey}.task`)}1</span>
          </div>
          <div className="d-flex align-items-center mb-1 ps-4">
            <span
              style={{
                display: 'inline-block',
                width: '18px',
                height: '18px',
                border: '1px solid #757575',
                borderRadius: '2px',
                marginRight: '10px',
              }}
            />
            <span>{t(`${i18nKey}.task`)}1-1</span>
          </div>
          <div className="d-flex align-items-center ps-4">
            <span style={{ fontSize: '16px', marginRight: '10px', userSelect: 'none' }}>☑️</span>
            <span>{t(`${i18nKey}.task`)}1-2</span>
          </div>
        </div>
      ),
    },
    {
      id: 'quote',
      title: t(`${i18nKey}.quote`),
      code: `> ${t(`${i18nKey}.quote_text`)}\n>> ${t(`${i18nKey}.multi_quote`)}`,
      preview: (
        <blockquote className="border-start border-4 ps-3 text-muted italic">
          {t(`${i18nKey}.quote_text`)}
          <blockquote className="border-start border-2 ps-3 mt-2">{t(`${i18nKey}.multi_quote`)}</blockquote>
        </blockquote>
      ),
    },
    {
      id: 'hr',
      title: t(`${i18nKey}.hr`),
      code: '***\n\n―――\n\n---',
      preview: (
        <div className="d-flex flex-column gap-4 w-100">
          <hr className="my-0 opacity-75" style={{ borderTop: '1px solid #E6E5E3' }} />
          <hr className="my-0 opacity-75" style={{ borderTop: '1px solid #E6E5E3' }} />
          <hr className="my-0 opacity-75" style={{ borderTop: '1px solid #E6E5E3' }} />
        </div>
      ),
    },
    {
      id: 'br',
      title: t(`${i18nKey}.br`),
      code: t(`${i18nKey}.br_code`),
      preview: (
        <div className="lh-base" style={{ color: '#24292e' }}>
          {t(`${i18nKey}.br_preview_1`)}
          <br />
          {t(`${t(`${i18nKey}.br_preview_2`)}`)}
        </div>
      ),
    },
    {
      id: 'code-block',
      title: t(`${i18nKey}.code_block`),
      code: `\`\`\`\n${t(`${i18nKey}.code_block_text`)}\n\`\`\``,
      preview: (
        <div
          className="rounded p-3 w-100"
          style={{
            backgroundColor: '#22272e',
            color: '#ABB2BF',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            minWidth: '200px',
          }}
        >
          {t(`${i18nKey}.code_block_text`)}
        </div>
      ),
    },
    {
      id: 'table1',
      title: t(`${i18nKey}.table`),
      code: [
        `| ${t(`${i18nKey}.left`)} | ${t(`${i18nKey}.right`)} | ${t(`${i18nKey}.center`)} |`,
        '|:-------------- | --------------:| :--------------: |',
        `| ${t(`${i18nKey}.row_text`)} | ${t(`${i18nKey}.row_text`)} | ${t(`${i18nKey}.row_text`)} |`,
        `| ${t(`${i18nKey}.left`)}${t(`${i18nKey}.row_display`)} | ${t(`${i18nKey}.right`)}${t(`${i18nKey}.row_display`)} | `
        + `${t(`${i18nKey}.center`)}${t(`${i18nKey}.row_display`)} |`,
      ].join('\n'),
      preview: null,
      underContent: (
        <div
          className="table-responsive"
          style={{
            marginTop: '0.5rem',
            width: 'fit-content',
          }}
        >
          <table
            className="table table-sm table-bordered mb-0 small"
            style={{ tableLayout: 'auto', width: '100%', minWidth: '580px' }}
          >
            <thead>
              <tr className="bg-white">
                <th className="text-start fw-bold p-2 align-middle">{t(`${i18nKey}.left`)}</th>
                <th className="text-end fw-bold p-2 align-middle">{t(`${i18nKey}.right`)}</th>
                <th className="text-center fw-bold p-2 align-middle">{t(`${i18nKey}.center`)}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-start p-2">{t(`${i18nKey}.row_text`)}</td>
                <td className="text-end p-2">{t(`${i18nKey}.row_text`)}</td>
                <td className="text-center p-2">{t(`${i18nKey}.row_text`)}</td>
              </tr>
              <tr>
                <td className="text-start p-2">{t(`${i18nKey}.left`)}{t(`${i18nKey}.row_display`)}</td>
                <td className="text-end p-2">{t(`${i18nKey}.right`)}{t(`${i18nKey}.row_display`)}</td>
                <td className="text-center p-2">{t(`${i18nKey}.center`)}{t(`${i18nKey}.row_display`)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ),
    },
  ];

  return (
    <div className="px-4 py-3 overflow-y-auto" style={{ maxHeight: '80vh', minWidth: '650px' }}>
      {LAYOUT_GUIDES.map(item => (
        <GuideRow key={item.id} {...item} />
      ))}

      <GuideRow
        title={t(`${i18nKey}.footnote`)}
        code={`${t(`${i18nKey}.footnote_label`)}[^1].\n\n[^1]: ${t(`${i18nKey}.footnote_desc`)}.`}
        preview={(
          <div
            style={{
              color: '#223246',
              fontSize: '16px',
              lineHeight: '27px',
              fontFamily: 'Noto Sans CJK JP',
            }}
          >
            {t(`${i18nKey}.footnote_label`)}
            <sup style={{ fontSize: '0.6em', color: '#223246', marginLeft: '1px' }}>[1]</sup>
          </div>
        )}
        underContent={(
          <div
            style={{
              color: '#777570',
            }}
          >
            1. {t(`${i18nKey}.footnote_desc`)}
          </div>
        )}
      />
    </div>
  );
};
