import type { JSX } from 'react';
import { useEffect, useId } from 'react';
import { useTranslation } from 'next-i18next';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { Button, FormFeedback, FormGroup, Input, Label } from 'reactstrap';

import { toastError, toastSuccess } from '~/client/util/toastr';

import type { AutoApplyPolicy, CreatableOperationType } from '../../interfaces';
import {
  buildUpdateRequest,
  type ChangeProposalSettingsFormValues,
  isValidLimitText,
  OPERATION_TYPES,
  toFormValues,
} from './change-proposal-settings-form-values';
import { EnvOnlyModeNotice } from './EnvOnlyModeNotice';
import { registerToInputProps } from './register-to-input-props';
import { useChangeProposalSettings } from './use-change-proposal-settings';

const AUTO_APPLY_POLICIES = [
  'none',
  'own-pages',
  'all',
] as const satisfies readonly AutoApplyPolicy[];

/**
 * Admin screen for the Change Proposal settings (/admin/change-proposal).
 *
 * One form, one PUT carrying only the changed values. Under env-only mode the PUT
 * refuses every change, so the whole form is read-only.
 */
export const ChangeProposalSettings = (): JSX.Element | null => {
  const { t } = useTranslation('admin');
  const { data, save } = useChangeProposalSettings();
  const idPrefix = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangeProposalSettingsFormValues>({
    defaultValues: data != null ? toFormValues(data) : undefined,
  });

  // Re-seed on load and after a successful save; a failed save keeps the input.
  useEffect(() => {
    if (data != null) {
      reset(toFormValues(data));
    }
  }, [data, reset]);

  if (data == null) {
    return null;
  }

  const onSubmit: SubmitHandler<ChangeProposalSettingsFormValues> = async (
    values,
  ) => {
    const update = buildUpdateRequest(data, values);
    // An empty PUT would still record a settings-update activity.
    if (Object.keys(update).length === 0) {
      toastSuccess(t('change_proposal_settings.save_success'));
      return;
    }
    try {
      await save(update);
      toastSuccess(t('change_proposal_settings.save_success'));
    } catch (err) {
      // apiv3 rejects with the list of ErrorV3 from the response.
      toastError(err as Error | Error[]);
    }
  };

  const operationTypeLabels: Record<CreatableOperationType, string> = {
    edit: t('change_proposal_settings.operation_type_edit'),
    create: t('change_proposal_settings.operation_type_create'),
    move: t('change_proposal_settings.operation_type_move'),
  };
  const autoApplyPolicyLabels: Record<AutoApplyPolicy, string> = {
    none: t('change_proposal_settings.auto_apply_policy_none'),
    'own-pages': t('change_proposal_settings.auto_apply_policy_own_pages'),
    all: t('change_proposal_settings.auto_apply_policy_all'),
  };
  const limitRule = {
    validate: (text: string) =>
      isValidLimitText(text) || t('change_proposal_settings.limit_invalid'),
  };

  const ids = {
    isEnabled: `${idPrefix}-is-enabled`,
    autoApplyPolicy: `${idPrefix}-auto-apply-policy`,
    maxOperations: `${idPrefix}-max-operations`,
    maxPerDay: `${idPrefix}-max-per-day`,
    perPageNotifications: `${idPrefix}-per-page-notifications`,
  };

  return (
    <form
      data-testid="change-proposal-settings"
      onSubmit={handleSubmit(onSubmit)}
    >
      {data.useOnlyEnvVars && <EnvOnlyModeNotice />}

      <p className="text-muted mb-4">
        {t('change_proposal_settings.description')}
      </p>

      <fieldset disabled={data.useOnlyEnvVars}>
        <div className="mb-4">
          <FormGroup switch className="mb-1">
            <Input
              id={ids.isEnabled}
              type="switch"
              role="switch"
              {...registerToInputProps(register('isEnabled'))}
            />
            <Label htmlFor={ids.isEnabled} className="ms-2 fw-bold">
              {t('change_proposal_settings.is_enabled')}
            </Label>
          </FormGroup>
          <p className="form-text text-muted mt-0">
            {t('change_proposal_settings.is_enabled_desc')}
          </p>
        </div>

        <div className="mb-4">
          <p className="form-label fw-bold mb-1">
            {t('change_proposal_settings.enabled_operation_types')}
          </p>
          {OPERATION_TYPES.map((type) => (
            <FormGroup check key={type}>
              <Input
                id={`${idPrefix}-operation-type-${type}`}
                type="checkbox"
                {...registerToInputProps(
                  register(`enabledOperationTypes.${type}`),
                )}
              />
              <Label check htmlFor={`${idPrefix}-operation-type-${type}`}>
                {operationTypeLabels[type]}
              </Label>
            </FormGroup>
          ))}
        </div>

        <div className="mb-4">
          <Label htmlFor={ids.autoApplyPolicy} className="form-label fw-bold">
            {t('change_proposal_settings.auto_apply_policy')}
          </Label>
          <Input
            id={ids.autoApplyPolicy}
            type="select"
            className="w-auto"
            {...registerToInputProps(register('autoApplyPolicy'))}
          >
            {AUTO_APPLY_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {autoApplyPolicyLabels[policy]}
              </option>
            ))}
          </Input>
        </div>

        <div className="mb-4">
          <Label htmlFor={ids.maxOperations} className="form-label fw-bold">
            {t('change_proposal_settings.max_operations_per_proposal')}
          </Label>
          <Input
            id={ids.maxOperations}
            type="text"
            inputMode="numeric"
            className="w-auto"
            placeholder={t(
              'change_proposal_settings.max_operations_per_proposal_unlimited',
            )}
            invalid={errors.maxOperationsPerProposal != null}
            {...registerToInputProps(
              register('maxOperationsPerProposal', limitRule),
            )}
          />
          <FormFeedback>
            {errors.maxOperationsPerProposal?.message}
          </FormFeedback>
        </div>

        <div className="mb-4">
          <Label htmlFor={ids.maxPerDay} className="form-label fw-bold">
            {t('change_proposal_settings.max_proposals_per_user_per_day')}
          </Label>
          <Input
            id={ids.maxPerDay}
            type="text"
            inputMode="numeric"
            className="w-auto"
            placeholder={t(
              'change_proposal_settings.max_proposals_per_user_per_day_unlimited',
            )}
            invalid={errors.maxProposalsPerUserPerDay != null}
            {...registerToInputProps(
              register('maxProposalsPerUserPerDay', limitRule),
            )}
          />
          <FormFeedback>
            {errors.maxProposalsPerUserPerDay?.message}
          </FormFeedback>
        </div>

        <div className="mb-4">
          <FormGroup switch className="mb-1">
            <Input
              id={ids.perPageNotifications}
              type="switch"
              role="switch"
              {...registerToInputProps(register('perPageNotificationsEnabled'))}
            />
            <Label htmlFor={ids.perPageNotifications} className="ms-2 fw-bold">
              {t('change_proposal_settings.per_page_notifications_enabled')}
            </Label>
          </FormGroup>
          <p className="form-text text-muted mt-0">
            {t('change_proposal_settings.per_page_notifications_enabled_desc')}
          </p>
        </div>

        <Button type="submit" color="primary" disabled={isSubmitting}>
          {t('change_proposal_settings.save')}
        </Button>
      </fieldset>
    </form>
  );
};
