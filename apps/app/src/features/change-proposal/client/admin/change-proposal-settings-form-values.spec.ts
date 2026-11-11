import type { ChangeProposalSettingsView } from '../../interfaces';
import {
  buildUpdateRequest,
  isValidLimitText,
  toFormValues,
} from './change-proposal-settings-form-values';

const view: ChangeProposalSettingsView = {
  isEnabled: true,
  enabledOperationTypes: ['edit', 'move'],
  autoApplyPolicy: 'own-pages',
  maxOperationsPerProposal: 50,
  maxProposalsPerUserPerDay: null,
  perPageNotificationsEnabled: false,
  useOnlyEnvVars: false,
};

describe('toFormValues', () => {
  it('maps limits to text, with an empty string for "no limit"', () => {
    const values = toFormValues(view);

    expect(values.maxOperationsPerProposal).toBe('50');
    expect(values.maxProposalsPerUserPerDay).toBe('');
  });

  it('maps the enabled operation types to one flag per type', () => {
    expect(toFormValues(view).enabledOperationTypes).toEqual({
      edit: true,
      create: false,
      move: true,
    });
  });
});

describe('buildUpdateRequest', () => {
  it('sends nothing when no value changed', () => {
    expect(buildUpdateRequest(view, toFormValues(view))).toEqual({});
  });

  it('sends only the changed values, with limits as numbers or null', () => {
    const values = {
      ...toFormValues(view),
      isEnabled: false,
      maxOperationsPerProposal: '',
      maxProposalsPerUserPerDay: '5',
    };

    expect(buildUpdateRequest(view, values)).toEqual({
      isEnabled: false,
      maxOperationsPerProposal: null,
      maxProposalsPerUserPerDay: 5,
    });
  });

  it('sends the operation types as a list in a fixed order, empty when all are off', () => {
    const allOn = {
      ...toFormValues(view),
      enabledOperationTypes: { edit: true, create: true, move: true },
    };
    const allOff = {
      ...toFormValues(view),
      enabledOperationTypes: { edit: false, create: false, move: false },
    };

    expect(buildUpdateRequest(view, allOn)).toEqual({
      enabledOperationTypes: ['edit', 'create', 'move'],
    });
    expect(buildUpdateRequest(view, allOff)).toEqual({
      enabledOperationTypes: [],
    });
  });

  it('does not send the operation types when only their order differs', () => {
    const reordered: ChangeProposalSettingsView = {
      ...view,
      enabledOperationTypes: ['move', 'edit'],
    };

    expect(buildUpdateRequest(reordered, toFormValues(reordered))).toEqual({});
  });

  it('sends the auto-apply policy and the per-page notification setting when changed', () => {
    const values = {
      ...toFormValues(view),
      autoApplyPolicy: 'all' as const,
      perPageNotificationsEnabled: true,
    };

    expect(buildUpdateRequest(view, values)).toEqual({
      autoApplyPolicy: 'all',
      perPageNotificationsEnabled: true,
    });
  });
});

describe('isValidLimitText', () => {
  it.each(['', '1', '50', ' 7 '])('accepts %j', (text) => {
    expect(isValidLimitText(text)).toBe(true);
  });

  it.each([
    '0',
    '-1',
    '1.5',
    'abc',
    '1e3',
    '99999999999999999999',
  ])('refuses %j', (text) => {
    expect(isValidLimitText(text)).toBe(false);
  });
});
