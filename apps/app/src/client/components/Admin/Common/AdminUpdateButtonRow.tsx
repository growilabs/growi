import React, { type JSX } from 'react';

import { useTranslation } from 'next-i18next';

type Props = {
  onClick?: () => void,
  disabled?: boolean,
  type?: 'button' | 'submit' | 'reset',
}

const AdminUpdateButtonRow = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <div className="row my-3">
      <div className="col-md-3"></div>
      <div className="col-md-9">
        <button
          // eslint-disable-next-line react/button-has-type
          type={props.type ?? 'button'}
          className="btn btn-primary"
          onClick={props.onClick}
          disabled={props.disabled ?? false}
        >
          { t('Update') }
        </button>
      </div>
    </div>
  );
};

export default AdminUpdateButtonRow;
