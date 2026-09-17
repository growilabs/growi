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
 * A request originating from a workspace under an org-wide install still carries
 * that workspace's real teamId, even though the stored row (C) has none. That is
 * why the lookup has to fall back from teamId to enterpriseId.
 */

type InstallationRow = {
  id: number;
  teamId?: string;
  enterpriseId?: string;
  isEnterpriseInstall: boolean;
  deactivatedAt?: Date | null;
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
const deactivatedGridWorkspace: InstallationRow = {
  id: 4,
  teamId: TEAM_GRID_WORKSPACE,
  enterpriseId: ENTERPRISE,
  isEnterpriseInstall: false,
  deactivatedAt: new Date('2026-01-01'),
};

const matchesWhere = (
  row: InstallationRow,
  where: Record<string, unknown>,
): boolean =>
  Object.entries(where).every(([key, expected]) => {
    const actual = row[key as keyof InstallationRow];
    if (expected instanceof FindOperator) {
      // Fail loudly rather than silently accepting a condition this fake does
      // not implement, so swapping IsNull() for another operator is caught.
      if (expected.type !== 'isNull') {
        throw new Error(`unsupported operator on "${key}": ${expected.type}`);
      }
      return actual == null;
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

  it('should resolve a Grid workspace-level install by its teamId, not by its enterpriseId', async () => {
    // Arrange
    const repository = setupRepository([soloWorkspace, gridWorkspace, orgWide]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_GRID_WORKSPACE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(gridWorkspace);
  });

  it('should fall back to the org-wide install when the incoming teamId matches no row', async () => {
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

  it('should not resolve a deactivated row', async () => {
    // Arrange: the workspace-level install was superseded by an org-wide install
    const repository = setupRepository([deactivatedGridWorkspace, orgWide]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_GRID_WORKSPACE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(orgWide);
  });

  it('should return undefined when only a deactivated row matches', async () => {
    // Arrange
    const repository = setupRepository([deactivatedGridWorkspace]);

    // Act
    const result = await repository.findByTeamIdOrEnterpriseId(
      TEAM_GRID_WORKSPACE,
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

  it('should find a deactivated row, so re-installing restores the relations on it', async () => {
    // Arrange
    const repository = setupRepository([deactivatedGridWorkspace, orgWide]);

    // Act
    const result = await repository.findForUpsert(
      TEAM_GRID_WORKSPACE,
      ENTERPRISE,
    );

    // Assert
    expect(result).toBe(deactivatedGridWorkspace);
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
