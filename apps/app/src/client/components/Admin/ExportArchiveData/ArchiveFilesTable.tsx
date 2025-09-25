import React, { type JSX } from 'react';

import { format } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import ArchiveFilesTableMenu from './ArchiveFilesTableMenu';

type ArchiveFilesTableProps = {
  zipFileStats: any[],
  onZipFileStatRemove: (fileName: string) => void,
}

const ArchiveFilesTable = (props: ArchiveFilesTableProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <table className="table table-bordered">
      <thead>
        <tr>
          <th>{t('admin:export_management.file')}</th>
          <th>{t('admin:export_management.growi_version')}</th>
          <th>{t('admin:export_management.collections')}</th>
          <th>{t('admin:export_management.exported_at')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {props.zipFileStats.map(({ meta, fileName, innerFileStats }) => {
          return (
            <tr key={fileName}>
              <th>{fileName}</th>
              <td>{meta.version}</td>
              <td className="text-capitalize">{innerFileStats.map(fileStat => fileStat.collectionName).join(', ')}</td>
              <td>{meta.exportedAt ? format(new Date(meta.exportedAt), 'yyyy/MM/dd HH:mm:ss') : ''}</td>
              <td>
                <ArchiveFilesTableMenu
                  fileName={fileName}
                  onZipFileStatRemove={props.onZipFileStatRemove}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default ArchiveFilesTable;
