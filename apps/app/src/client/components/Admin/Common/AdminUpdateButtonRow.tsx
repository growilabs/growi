import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

type Props = {
  onClick: () => void,
  disabled?: boolean,
}

const AdminUpdateButtonRow = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <div className="row my-3">
      <div className="mx-auto">
        <button type="button" className="btn btn-primary" onClick={props.onClick} disabled={props.disabled ?? false}>{ t('Update') }</button>
      </div>
    </div>
  );
};

export default AdminUpdateButtonRow;
