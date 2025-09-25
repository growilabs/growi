import { useTranslation } from 'next-i18next';
import { type JSX, useState } from 'react';
import { Collapse } from 'reactstrap';

export const SearchHelp = (): JSX.Element => {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn border-0 text-muted d-flex justify-content-center align-items-center ms-1 p-0"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="material-symbols-outlined me-2 p-0">help</span>
        <span>{t('search_help.title')}</span>
        <span className="material-symbols-outlined ms-2 p-0">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      <Collapse isOpen={isOpen}>
        <table className="table table-borderless m-0">
          <tbody>
            <tr className="border-bottom">
              <th className="py-2">
                <code>word1</code> <code>word2</code>
                <br />
                <small className="text-muted">
                  ({t('search_help.and.syntax help')})
                </small>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.and.desc', {
                    word1: 'word1',
                    word2: 'word2',
                  })}
                </h6>
              </td>
            </tr>
            <tr className="border-bottom">
              <th className="py-2">
                <code>&quot;This is GROWI&quot;</code>
                <br />
                <small className="text-muted">
                  ({t('search_help.phrase.syntax help')})
                </small>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.phrase.desc', { phrase: 'This is GROWI' })}
                </h6>
              </td>
            </tr>
            <tr className="border-bottom">
              <th className="py-2">
                <code>-keyword</code>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.exclude.desc', { word: 'keyword' })}
                </h6>
              </td>
            </tr>
            <tr className="border-bottom">
              <th className="py-2">
                <code>prefix:/user/</code>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.prefix.desc', { path: '/user/' })}
                </h6>
              </td>
            </tr>
            <tr className="border-bottom">
              <th className="py-2">
                <code>-prefix:/user/</code>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.exclude_prefix.desc', { path: '/user/' })}
                </h6>
              </td>
            </tr>
            <tr className="border-bottom">
              <th className="py-2">
                <code>tag:wiki</code>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.tag.desc', { tag: 'wiki' })}
                </h6>
              </td>
            </tr>
            <tr>
              <th className="py-2">
                <code>-tag:wiki</code>
              </th>
              <td>
                <h6 className="m-0 text-muted">
                  {t('search_help.exclude_tag.desc', { tag: 'wiki' })}
                </h6>
              </td>
            </tr>
          </tbody>
        </table>
      </Collapse>
    </>
  );
};
