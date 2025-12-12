import React from 'react';

import { LoadingSpinner } from '@growi/ui/dist/components';

import AdminHomeContainer from '~/client/services/AdminHomeContainer';

import { withUnstatedContainers } from '../../UnstatedUtils';


type Props = {
  adminHomeContainer: AdminHomeContainer,
}

const SystemInformationTable = (props: Props) => {
  const { adminHomeContainer } = props;

  const {
    growiVersion, nodeVersion, npmVersion, pnpmVersion,
  } = adminHomeContainer.state;

  if (growiVersion == null || nodeVersion == null || npmVersion == null || pnpmVersion == null) {
    return <LoadingSpinner />;
  }

  return (
    <table data-testid="admin-system-information-table" className="table table-bordered">
      <tbody>
        <tr>
          <th>GROWI</th>
          <td data-vrt-blackout>{ growiVersion }</td>
        </tr>
        <tr>
          <th>node.js</th>
          <td>{ nodeVersion }</td>
        </tr>
        <tr>
          <th>npm</th>
          <td>{ npmVersion }</td>
        </tr>
        <tr>
          <th>pnpm</th>
          <td>{ pnpmVersion }</td>
        </tr>
      </tbody>
    </table>
  );

};

/**
 * Wrapper component for using unstated
 */
const SystemInformationTableWrapper = withUnstatedContainers(SystemInformationTable, [AdminHomeContainer]);

export default SystemInformationTableWrapper;
