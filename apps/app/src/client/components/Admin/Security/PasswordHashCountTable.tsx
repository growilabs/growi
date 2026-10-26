import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { PasswordHashFormatCounts } from '~/interfaces/password-hash-status';

const I18N_PREFIX = 'security_settings.legacy_password_cleanup';

export const sumLegacyOnly = (counts: PasswordHashFormatCounts): number =>
  counts.legacyOnly.active + counts.legacyOnly.nonActive;

type Props = {
  counts: PasswordHashFormatCounts;
};

export const PasswordHashCountTable = ({ counts }: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <table className="table table-bordered w-auto mb-3">
      <tbody>
        <tr>
          <th scope="row">{t(`${I18N_PREFIX}.count_label.upgraded_only`)}</th>
          <td>{counts.upgradedOnly}</td>
        </tr>
        <tr className="table-warning">
          <th scope="row">{t(`${I18N_PREFIX}.count_label.both`)}</th>
          <td>{counts.both}</td>
        </tr>
        <tr>
          <th scope="row">{t(`${I18N_PREFIX}.count_label.legacy_only`)}</th>
          <td>{sumLegacyOnly(counts)}</td>
        </tr>
        <tr>
          <th scope="row" className="ps-4 fw-normal">
            {t(`${I18N_PREFIX}.count_label.legacy_only_active`)}
          </th>
          <td>{counts.legacyOnly.active}</td>
        </tr>
        <tr>
          <th scope="row" className="ps-4 fw-normal">
            {t(`${I18N_PREFIX}.count_label.legacy_only_non_active`)}
          </th>
          <td>{counts.legacyOnly.nonActive}</td>
        </tr>
        <tr>
          <th scope="row">{t(`${I18N_PREFIX}.count_label.no_password`)}</th>
          <td>{counts.noPassword}</td>
        </tr>
      </tbody>
    </table>
  );
};
