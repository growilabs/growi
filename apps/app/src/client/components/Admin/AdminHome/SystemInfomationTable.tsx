import { LoadingSpinner } from '@growi/ui/dist/components';

import { useSWRxAdminHome } from '~/stores/admin/admin-home';

const SystemInformationTable = () => {
  const { data: adminHomeData } = useSWRxAdminHome();

  const { growiVersion, nodeVersion, npmVersion, pnpmVersion } =
    adminHomeData ?? {};

  if (
    growiVersion == null ||
    nodeVersion == null ||
    npmVersion == null ||
    pnpmVersion == null
  ) {
    return <LoadingSpinner />;
  }

  return (
    <table
      data-testid="admin-system-information-table"
      className="table table-bordered"
    >
      <tbody>
        <tr>
          <th>GROWI</th>
          <td data-vrt-blackout>{growiVersion}</td>
        </tr>
        <tr>
          <th>node.js</th>
          <td>{nodeVersion}</td>
        </tr>
        <tr>
          <th>npm</th>
          <td>{npmVersion}</td>
        </tr>
        <tr>
          <th>pnpm</th>
          <td>{pnpmVersion}</td>
        </tr>
      </tbody>
    </table>
  );
};

export default SystemInformationTable;
