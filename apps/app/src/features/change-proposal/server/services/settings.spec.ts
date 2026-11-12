import { mock } from 'vitest-mock-extended';

import type { IConfigManagerForApp } from '~/server/service/config-manager';

import {
  readChangeProposalSettings,
  updateChangeProposalSettings,
} from './settings';

const { configManagerMock } = vi.hoisted(() => ({
  configManagerMock: { current: undefined as unknown },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: new Proxy(
    {},
    {
      get: (_target, prop) =>
        (configManagerMock.current as Record<string | symbol, unknown>)[prop],
    },
  ),
}));

const stubConfigs = (values: Record<string, unknown>): IConfigManagerForApp => {
  const manager = mock<IConfigManagerForApp>();
  manager.getConfig.mockImplementation(((key: string) => values[key]) as never);
  configManagerMock.current = manager;
  return manager;
};

const allDefaults = {
  'app:changeProposalEnabled': false,
  'changeProposal:isEditEnabled': true,
  'changeProposal:isCreateEnabled': true,
  'changeProposal:isMoveEnabled': true,
  'changeProposal:autoApplyPolicy': 'none',
  'changeProposal:maxOperationsPerProposal': null,
  'changeProposal:maxProposalsPerUserPerDay': null,
  'changeProposal:pendingExpirationSeconds': null,
  'changeProposal:perPageNotificationsEnabled': false,
};

describe('readChangeProposalSettings', () => {
  it('returns the declared defaults: write feature off, every operation type on, no auto-apply, no per-page notifications', () => {
    stubConfigs(allDefaults);

    const settings = readChangeProposalSettings();

    expect(settings.isEnabled).toBe(false);
    expect(settings.enabledOperationTypes).toEqual(
      new Set(['edit', 'create', 'move']),
    );
    expect(settings.autoApplyPolicy).toBe('none');
    expect(settings.perPageNotificationsEnabled).toBe(false);
    expect(settings.maxOperationsPerProposal).toBeNull();
    expect(settings.maxProposalsPerUserPerDay).toBeNull();
    expect(settings.pendingExpirationSeconds).toBeNull();
  });

  it('excludes operation types whose switch is off', () => {
    stubConfigs({
      ...allDefaults,
      'changeProposal:isCreateEnabled': false,
      'changeProposal:isMoveEnabled': false,
    });

    expect(readChangeProposalSettings().enabledOperationTypes).toEqual(
      new Set(['edit']),
    );
  });

  it('returns numeric limits and policy as configured', () => {
    stubConfigs({
      ...allDefaults,
      'app:changeProposalEnabled': true,
      'changeProposal:autoApplyPolicy': 'own-pages',
      'changeProposal:maxOperationsPerProposal': 50,
      'changeProposal:maxProposalsPerUserPerDay': 10,
      'changeProposal:pendingExpirationSeconds': 86400,
      'changeProposal:perPageNotificationsEnabled': true,
    });

    expect(readChangeProposalSettings()).toMatchObject({
      isEnabled: true,
      autoApplyPolicy: 'own-pages',
      maxOperationsPerProposal: 50,
      maxProposalsPerUserPerDay: 10,
      pendingExpirationSeconds: 86400,
      perPageNotificationsEnabled: true,
    });
  });

  it('falls back to "none" when the stored policy is not a known value', () => {
    stubConfigs({ ...allDefaults, 'changeProposal:autoApplyPolicy': 'bogus' });

    expect(readChangeProposalSettings().autoApplyPolicy).toBe('none');
  });

  it('treats a non-positive or non-finite stored limit as no value', () => {
    stubConfigs({
      ...allDefaults,
      'changeProposal:maxOperationsPerProposal': Number.NaN,
      'changeProposal:maxProposalsPerUserPerDay': 0,
      'changeProposal:pendingExpirationSeconds': -5,
    });

    const settings = readChangeProposalSettings();
    expect(settings.maxOperationsPerProposal).toBeNull();
    expect(settings.maxProposalsPerUserPerDay).toBeNull();
    expect(settings.pendingExpirationSeconds).toBeNull();
  });

  it('reads from the config manager on every call', () => {
    stubConfigs(allDefaults);
    expect(readChangeProposalSettings().isEnabled).toBe(false);

    stubConfigs({ ...allDefaults, 'app:changeProposalEnabled': true });
    expect(readChangeProposalSettings().isEnabled).toBe(true);
  });
});

describe('updateChangeProposalSettings', () => {
  it('writes only the supplied fields, mapped to their config keys', async () => {
    const manager = stubConfigs(allDefaults);

    await updateChangeProposalSettings({
      isEnabled: true,
      autoApplyPolicy: 'all',
      maxProposalsPerUserPerDay: 5,
      perPageNotificationsEnabled: true,
    });

    expect(manager.updateConfigs).toHaveBeenCalledWith({
      'app:changeProposalEnabled': true,
      'changeProposal:autoApplyPolicy': 'all',
      'changeProposal:maxProposalsPerUserPerDay': 5,
      'changeProposal:perPageNotificationsEnabled': true,
    });
  });

  it('turns enabledOperationTypes into the three per-type switches', async () => {
    const manager = stubConfigs(allDefaults);

    await updateChangeProposalSettings({
      enabledOperationTypes: ['edit', 'move'],
    });

    expect(manager.updateConfigs).toHaveBeenCalledWith({
      'changeProposal:isEditEnabled': true,
      'changeProposal:isCreateEnabled': false,
      'changeProposal:isMoveEnabled': true,
    });
  });

  it('stores 0 to clear a limit so the default does not take over', async () => {
    const manager = stubConfigs(allDefaults);

    await updateChangeProposalSettings({
      maxOperationsPerProposal: null,
      maxProposalsPerUserPerDay: null,
    });

    expect(manager.updateConfigs).toHaveBeenCalledWith({
      'changeProposal:maxOperationsPerProposal': 0,
      'changeProposal:maxProposalsPerUserPerDay': 0,
    });
  });

  it('reads a cleared limit back as null', async () => {
    const stored: Record<string, unknown> = {
      ...allDefaults,
      'changeProposal:maxOperationsPerProposal': 50,
    };
    const manager = stubConfigs(stored);
    Object.assign(manager, {
      updateConfigs: (updates: Record<string, unknown>) => {
        Object.assign(stored, updates);
        return Promise.resolve();
      },
    });

    await updateChangeProposalSettings({ maxOperationsPerProposal: null });

    expect(readChangeProposalSettings().maxOperationsPerProposal).toBeNull();
  });

  it('does not touch the config manager for an empty update', async () => {
    const manager = stubConfigs(allDefaults);

    await updateChangeProposalSettings({});

    expect(manager.updateConfigs).not.toHaveBeenCalled();
  });
});
