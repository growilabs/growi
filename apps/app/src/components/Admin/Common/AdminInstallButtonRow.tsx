import React from 'react';

import { useTranslation } from 'next-i18next';

type Props = {
  onClick: () => void,
  disabled: boolean,

}

export const AdminInstallButtonRow = (props: Props): JSX.Element => {
  // TODO: const { t } = useTranslation('admin');

  return (
    <div className="row my-3">
      <div className="mx-auto">
        <button type="button" className="btn btn-primary" onClick={props.onClick} disabled={props.disabled}>Install</button>
      </div>
    </div>
  );
};
