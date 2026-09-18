import { FindOperator } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { InstallationRepository } from './installation';

// TypeORM's column decorators need emitDecoratorMetadata, which the test
// transform does not produce. The lookup logic under test never touches the
// entity class itself, so a bare stand-in keeps the decorators out of the way.
// (vitest hoists this above the imports.)
vi.mock('~/entities/installation', () => ({
  Installation: class {},
}));

/*
 * A Slack app can be installed in three shapes, and each one is stored differently:
 *
 *   A. Solo workspace (non-Grid)      teamId only
 *   B. Grid, workspace-level install  teamId and enterpriseId, isEnterpriseInstall=false
 *   C. Grid, org-wide install         enterpriseId only, isEnterpriseInstall=true
 *
 * B and C coexist permanently: Slack keeps workspace-level installs working after
 * an org-wide one, so the lookup cannot assume the workspace rows are gone. It
 * resolves the org-wide row first and reaches a workspace-level row only when the
 * organization has no org-wide install. A request always carries the originating
 * workspace's real teamId, even when the row that serves it (C) has none.
 */

type InstallationRow = {
  id: number;
  teamId?: string;
  enterpriseId?: string;
  isEnterpriseInstall: boolean;
};

const TEAM_SOLO = 'T_SOLO';
const TEAM_GRID_WORKSPACE = 'T_GRID_WORKSPACE';
const TEAM_UNDER_ORG_WIDE = 'T_UNDER_ORG_WIDE';
const ENTERPRISE = 'E_ORG';

const soloWorkspace: InstallationRow = {
  id: 1,
  teamId: TEAM_SOLO,
  isEnterpriseInstall: false,
};
const gridWorkspace: InstallationRow = {
  id: 2,
  teamId: TEAM_GRID_WORKSPACE,
  enterpriseId: ENTERPRISE,
  isEnterpriseInstall: false,
};
const orgWide: InstallationRow = {
  id: 3,
  enterpriseId: ENTERPRISE,
  isEnterpriseInstall: true,
};

const matchesWhere = (
  row: InstallationRow,
  where: Record<string, unknown>,
): boolean =>
  Object.entries(where).every(([key, expected]) => {
    const actual = row[key as keyof InstallationRow];
    if (expected instanceof FindOperator) {
      // Fail loudly rather than silently accepting a condition this fake does
      // not implement, so a new operator in a where clause is caught here.
      throw new Error(`unsupported operator on "${key}": ${expected.type}`);
    }
    return actual === expected;
  });

/**
 * Runs the real lookup logic against an in-memory row set, so the assertions can
 * be about which row comes back rather than about which queries were issued.
 */
const setupRepository = (rows: InstallationRow[]): InstallationRepository => {
  const repository = new InstallationRepository();
  // WHY: findOne is heavily overloaded, so the replacement cannot be typed
  // without restating every signature.
  repository.findOne = (async (options: { where: Record<string, unknown> }) =>
    rows.find((row) => matchesWhere(row, options.where))) as never;
  return repository;
};

describe('InstallationRepository.findByTeamIdOrEnterpriseId', () => {
  it('should resolve a solo workspace install by its teamId', async () => {
    // Arrange
    const repository = setupRepository([soloWorkspace, gridWorkspace, orgWide]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_SOLO,
      undefined,
    );

    // Assert
    expect(result).toBe(soloWorkspace);
  });

  it('should resolve a Grid workspace-level install when its organization has no org-wide install', async () => {
    // Arrange
    const repository = setupRepository([soloWorkspace, gridWorkspace]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_GRID_WORKSPACE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(gridWorkspace);
  });

  it('should resolve the org-wide install for a request from a workspace it covers', async () => {
    // Arrange: an org-wide install stores no teamId, yet the request carries one
    const repository = setupRepository([soloWorkspace, orgWide]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_UNDER_ORG_WIDE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(orgWide);
  });

  it('should prefer the org-wide install over a workspace-level install of the same team', async () => {
    // Arrange: Slack leaves the workspace-level install in place after an
    // org-wide one, so both rows are live and the org-wide token is the one
    // that now covers this workspace
    const repository = setupRepository([gridWorkspace, orgWide]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_GRID_WORKSPACE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(orgWide);
  });

  it('should not resolve another workspace of the same organization through its enterpriseId', async () => {
    // Arrange: a sibling workspace is installed, this one is not
    const repository = setupRepository([gridWorkspace]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_UNDER_ORG_WIDE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return undefined when neither id is given', async () => {
    // Arrange
    const repository = setupRepository([soloWorkspace, gridWorkspace, orgWide]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      undefined,
      undefined,
    );

    // Assert
    expect(result).toBeUndefined();
  });
});

describe('InstallationRepository.findForUpsert', () => {
  it('should find the row of the workspace being installed', async () => {
    // Arrange
    const repository = setupRepository([soloWorkspace, gridWorkspace, orgWide]);

    // Act
    const result = await repository.findForUpsert(
      TEAM_GRID_WORKSPACE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(gridWorkspace);
  });

  it('should not fall back to the org-wide row, so a workspace-level save cannot overwrite it', async () => {
    // Arrange: a workspace of the organization that has never been installed yet
    const repository = setupRepository([orgWide]);

    // Act
    const result = await repository.findForUpsert(
      TEAM_UNDER_ORG_WIDE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBeUndefined();
  });

  it('should find the org-wide row when the installation has no team', async () => {
    // Arrange
    const repository = setupRepository([gridWorkspace, orgWide]);

    // Act
    const result = await repository.findForUpsert(undefined, ENTERPRISE);

    // Assert
    expect(result).toBe(orgWide);
  });

  it('should return undefined when neither id is given', async () => {
    // Arrange
    const repository = setupRepository([soloWorkspace, gridWorkspace, orgWide]);

    // Act
    const result = await repository.findForUpsert(undefined, undefined);

    // Assert
    expect(result).toBeUndefined();
  });
});
