import type React from 'react';
import { useTranslation } from 'react-i18next';

import type { LayoutGuideItem } from '../components/GuideRow';
import { GuideRow } from '../components/GuideRow';

import styles from './LayoutTab.module.scss';

export const LayoutTab: React.FC = () => {
  const { t } = useTranslation();
  const i18nKey = 'editor_guide.layout';

  const LAYOUT_GUIDES: LayoutGuideItem[] = [
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
        <div className="text-body lh-base">
          <h1 className="h2 border-bottom pb-1 mb-2 fw-normal">
            {t(`${i18nKey}.header_text`)}1
          </h1>
          <h2 className="h3 border-bottom pb-1 mb-2 fw-bold">
            {t(`${i18nKey}.header_text`)}2
          </h2>
          <h3 className="fs-5 mb-2 fw-bold">{t(`${i18nKey}.header_text`)}3</h3>
          <h4 className="fs-5 border-start border-4 ps-2 mb-2 fw-normal border-secondary-subtle">
            {t(`${i18nKey}.header_text`)}4
          </h4>
          <h5 className="fs-5 border-start border-4 ps-2 mb-2 fw-normal border-secondary-subtle">
            {t(`${i18nKey}.header_text`)}5
          </h5>
          <h6 className="fs-6 border-start border-4 ps-2 mb-0 fw-normal border-secondary-subtle">
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
        <ol className="ps-3 mb-0 text-body">
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
        <div className="text-body fs-6 lh-lg">
          <div className="d-flex align-items-center mb-1">
            <span className="me-2 user-select-none">☑️</span>
            <span>{t(`${i18nKey}.task`)}1</span>
          </div>
          <div className="d-flex align-items-center mb-1 ps-4">
            <span
              className={`d-inline-block border border-secondary rounded me-2 ${styles.checkboxMock}`}
            />
            <span>{t(`${i18nKey}.task`)}1-1</span>
          </div>
          <div className="d-flex align-items-center ps-4">
            <span className="me-2 user-select-none">☑️</span>
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
        <blockquote className="border-start border-4 ps-3 text-muted fst-italic border-secondary-subtle">
          {t(`${i18nKey}.quote_text`)}
          <blockquote className="border-start border-2 ps-3 mt-2">
            {t(`${i18nKey}.multi_quote`)}
          </blockquote>
        </blockquote>
      ),
    },
    {
      id: 'hr',
      title: t(`${i18nKey}.hr`),
      code: '***\n\n―――\n\n---',
      preview: (
        <div className="d-flex flex-column gap-4 w-100">
          <hr className="my-0 opacity-25" />
          <hr className="my-0 opacity-25" />
          <hr className="my-0 opacity-25" />
        </div>
      ),
    },
    {
      id: 'br',
      title: t(`${i18nKey}.br`),
      code: t(`${i18nKey}.br_code`),
      preview: (
        <div className="text-body lh-base">
          {t(`${i18nKey}.br_preview_1`)}
          <br />
          {t(`${i18nKey}.br_preview_2`)}
        </div>
      ),
    },
    {
      id: 'code-block',
      title: t(`${i18nKey}.code_block`),
      code: `\`\`\`\n${t(`${i18nKey}.code_block_text`)}\n\`\`\``,
      preview: (
        <div
          className="rounded p-3 w-100 font-monospace"
          style={{
            minWidth: '200px',
            backgroundColor: 'var(--bs-dark)',
          }}
        >
          <div className="small text-white-50 lh-base">
            {t(`${i18nKey}.code_block_text`)}
          </div>
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
        `| ${t(`${i18nKey}.left`)}${t(`${i18nKey}.row_display`)} | ${t(`${i18nKey}.right`)}${t(`${i18nKey}.row_display`)} | ` +
          `${t(`${i18nKey}.center`)}${t(`${i18nKey}.row_display`)} |`,
      ].join('\n'),
      underContent: (
        <div className={`table-responsive mt-2 ${styles.tableContainer}`}>
          <table className="table table-sm table-bordered mb-0 small text-body">
            <thead>
              <tr className="table-light">
                <th className="text-start fw-bold p-2 align-middle">
                  {t(`${i18nKey}.left`)}
                </th>
                <th className="text-end fw-bold p-2 align-middle">
                  {t(`${i18nKey}.right`)}
                </th>
                <th className="text-center fw-bold p-2 align-middle">
                  {t(`${i18nKey}.center`)}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-start p-2">{t(`${i18nKey}.row_text`)}</td>
                <td className="text-end p-2">{t(`${i18nKey}.row_text`)}</td>
                <td className="text-center p-2">{t(`${i18nKey}.row_text`)}</td>
              </tr>
              <tr>
                <td className="text-start p-2">
                  {t(`${i18nKey}.left`)}
                  {t(`${i18nKey}.row_display`)}
                </td>
                <td className="text-end p-2">
                  {t(`${i18nKey}.right`)}
                  {t(`${i18nKey}.row_display`)}
                </td>
                <td className="text-center p-2">
                  {t(`${i18nKey}.center`)}
                  {t(`${i18nKey}.row_display`)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: 'footnote',
      title: t(`${i18nKey}.footnote`),
      code: `${t(`${i18nKey}.footnote_label`)}[^1].\n\n[^1]: ${t(`${i18nKey}.footnote_desc`)}.`,
      preview: (
        <div className="text-body fs-6 lh-base">
          {t(`${i18nKey}.footnote_label`)}
          <sup className="ms-1 text-body small">[1]</sup>
        </div>
      ),
      underContent: (
        <div className="text-body-secondary small mt-1">
          1. {t(`${i18nKey}.footnote_desc`)}
        </div>
      ),
    },
  ];

  return (
    <div className={`px-4 py-3 overflow-y-auto ${styles.layoutTabContainer}`}>
      {LAYOUT_GUIDES.map((item) => (
        <GuideRow key={item.id} {...item} />
      ))}
    </div>
  );
};
