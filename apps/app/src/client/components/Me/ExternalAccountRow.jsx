
import React from 'react';

import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

const ExternalAccountRow = (props) => {
  const { t } = useTranslation();
  const { account } = props;

  return (
    <tr>
      <td>{ account.providerType }</td>
      <td>
        <strong>{ account.accountId }</strong>
      </td>
      <td>{dateFnsFormat(account.createdAt, 'yyyy-MM-dd')}</td>
      <td className="text-center">
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={() => props.openDisassociateModal(account)}
        >
          <span className="material-symbols-outlined">link_off</span>
          { t('Disassociate') }
        </button>
      </td>
    </tr>
  );
};

ExternalAccountRow.propTypes = {
  account: PropTypes.object.isRequired,
  openDisassociateModal: PropTypes.func.isRequired,
};

export default ExternalAccountRow;
