import React from 'react';
import type { UseFormRegister } from 'react-hook-form';

import AdminAppContainer from '~/client/services/AdminAppContainer';

import { withUnstatedContainers } from '../../UnstatedUtils';

type Props = {
  adminAppContainer?: AdminAppContainer;
  register: UseFormRegister<any>;
};

const SesSetting = (props: Props): JSX.Element => {
  const { register } = props;

  return (
    <React.Fragment>
      <div id="mail-ses" className="tab-pane active">
        <div className="row">
          <label
            className="text-start text-md-end col-md-3 col-form-label"
            htmlFor="admin-ses-access-key-id"
          >
            Access key ID
          </label>
          <div className="col-md-6">
            <input
              className="form-control"
              type="text"
              id="admin-ses-access-key-id"
              {...register('sesAccessKeyId')}
            />
          </div>
        </div>

        <div className="row">
          <label
            className="text-start text-md-end col-md-3 col-form-label"
            htmlFor="admin-ses-secret-access-key"
          >
            Secret access key
          </label>
          <div className="col-md-6">
            <input
              className="form-control"
              type="text"
              id="admin-ses-secret-access-key"
              {...register('sesSecretAccessKey')}
            />
          </div>
        </div>
      </div>
    </React.Fragment>
  );
};

export { SesSetting };

/**
 * Wrapper component for using unstated
 */
const SesSettingWrapper = withUnstatedContainers(SesSetting, [
  AdminAppContainer,
]);

export default SesSettingWrapper;
