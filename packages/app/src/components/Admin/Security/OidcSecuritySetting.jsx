/* eslint-disable react/no-danger */
import React from 'react';
import PropTypes from 'prop-types';

import { withUnstatedContainers } from '../../UnstatedUtils';
import { toastError } from '~/client/util/apiNotification';
import { toArrayIfNot } from '~/utils/array-utils';
import { withLoadingSppiner } from '../../SuspenseUtils';

import AdminOidcSecurityContainer from '~/client/services/AdminOidcSecurityContainer';

import OidcSecurityManagementContents from './OidcSecuritySettingContents';

let retrieveErrors = null;
function OidcSecurityManagement(props) {
  const { adminOidcSecurityContainer } = props;
  if (adminOidcSecurityContainer.state.oidcProviderName === adminOidcSecurityContainer.dummyOidcProviderName) {
    throw (async() => {
      try {
        await adminOidcSecurityContainer.retrieveSecurityData();
      }
      catch (err) {
        const errs = toArrayIfNot(err);
        toastError(errs);
        retrieveErrors = errs;
        adminOidcSecurityContainer.setState({ oidcProviderName: adminOidcSecurityContainer.dummyOidcProviderNameForError });
      }
    })();
  }

  if (adminOidcSecurityContainer.state.oidcProviderName === adminOidcSecurityContainer.dummyOidcProviderNameForError) {
    throw new Error(`${retrieveErrors.length} errors occured`);
  }

  return <OidcSecurityManagementContents />;
}

OidcSecurityManagement.propTypes = {
  adminOidcSecurityContainer: PropTypes.instanceOf(AdminOidcSecurityContainer).isRequired,
};

const OidcSecurityManagementWithUnstatedContainer = withUnstatedContainers(withLoadingSppiner(OidcSecurityManagement), [
  AdminOidcSecurityContainer,
]);

export default OidcSecurityManagementWithUnstatedContainer;
