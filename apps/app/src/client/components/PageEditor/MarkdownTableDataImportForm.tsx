import React, { useState, type JSX } from 'react';

import { MarkdownTable } from '@growi/editor';
import { useTranslation } from 'next-i18next';
import {
  Button,
  Collapse,
} from 'reactstrap';


type MarkdownTableDataImportFormProps = {
  onCancel: () => void,
  onImport: (table: MarkdownTable) => void,
}

export const MarkdownTableDataImportForm = (props: MarkdownTableDataImportFormProps): JSX.Element => {

  const { onCancel, onImport } = props;

  const { t } = useTranslation('commons', { keyPrefix: 'handsontable_modal.data_import_form' });

  const [dataFormat, setDataFormat] = useState<string>('csv');
  const [data, setData] = useState<string>('');
  const [parserErrorMessage, setParserErrorMessage] = useState(null);

  const convertFormDataToMarkdownTable = () => {
    let result;
    switch (dataFormat) {
      case 'csv':
        result = MarkdownTable.fromDSV(data, ',');
        break;
      case 'tsv':
        result = MarkdownTable.fromDSV(data, '\t');
        break;
      case 'html':
        result = MarkdownTable.fromHTMLTableTag(data);
        break;
    }
    return result.normalizeCells();
  };

  const importButtonHandler = () => {
    try {
      const markdownTable = convertFormDataToMarkdownTable();
      onImport(markdownTable);
      setParserErrorMessage(null);
    }
    catch (e) {
      setParserErrorMessage(e.message);
    }
  };

  return (
    <form className="data-import-form">
      <div>
        <label htmlFor="data-import-form-type-select" className="form-label">{t('select_data_format')}</label>
        <select
          id="data-import-form-type-select"
          className="form-select"
          value={dataFormat}
          onChange={(e) => { return setDataFormat(e.target.value) }}
        >
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
          <option value="html">HTML</option>
        </select>
      </div>
      <div className="mt-2">
        <label htmlFor="data-import-form-type-textarea" className="form-label">{t('import_data')}</label>
        <textarea
          id="data-import-form-type-textarea"
          className="form-control"
          placeholder={t('paste_table_data')}
          rows={8}
          onChange={(e) => { return setData(e.target.value) }}
        />
      </div>
      <Collapse isOpen={parserErrorMessage != null}>
        <div>
          <label htmlFor="data-import-form-type-textarea-alert" className="form-label">{t('parse_error')}</label>
          <textarea
            id="data-import-form-type-textarea-alert"
            className="form-control"
            rows={4}
            value={parserErrorMessage || ''}
            readOnly
          />
        </div>
      </Collapse>
      <div className="mt-3 d-flex justify-content-end">
        <Button color="outline-neutral-secondary me-2" onClick={onCancel}>{t('cancel')}</Button>
        <Button color="primary" onClick={importButtonHandler}>{t('import')}</Button>
      </div>
    </form>
  );

};
