import React from 'react';
import type { Scope } from '@growi/core/dist/interfaces';
import { addMonths } from 'date-fns/addMonths';
import { endOfDay } from 'date-fns/endOfDay';
import { format as dateFnsFormat } from 'date-fns/format';
import { parse } from 'date-fns/parse';
import { useTranslation } from 'next-i18next';
import { useForm } from 'react-hook-form';

import type { IAccessTokenInfo } from '~/interfaces/access-token';

import { AccessTokenScopeSelect } from './AccessTokenScopeSelect';

const MAX_DESCRIPTION_LENGTH = 200;

type AccessTokenFormProps = {
  submitHandler: (info: IAccessTokenInfo) => Promise<void>;
};

type FormInputs = {
  expiredAt: string;
  description: string;
  scopes: Scope[];
};

export const AccessTokenForm = React.memo(
  (props: AccessTokenFormProps): JSX.Element => {
    const { submitHandler } = props;
    const { t } = useTranslation();

    // <input type="date"> works in local dates; toISOString() gives the UTC date,
    // which differs from the local date for part of every day.
    const today = new Date();
    const defaultExpiredAtStr = dateFnsFormat(
      addMonths(today, 1),
      'yyyy-MM-dd',
    );
    const todayStr = dateFnsFormat(today, 'yyyy-MM-dd');

    const {
      register,
      handleSubmit,
      formState: { errors, isValid },
      watch,
    } = useForm<FormInputs>({
      defaultValues: {
        expiredAt: defaultExpiredAtStr,
        description: '',
        scopes: [],
      },
    });

    const onSubmit = (data: FormInputs) => {
      // Parse as a local date: `new Date('yyyy-MM-dd')` is UTC midnight, which is
      // already the previous day in time zones west of UTC.
      const expiredAtDate = endOfDay(
        parse(data.expiredAt, 'yyyy-MM-dd', new Date()),
      );
      const scopes: Scope[] = data.scopes ? data.scopes : [];

      submitHandler({
        expiredAt: expiredAtDate,
        description: data.description,
        scopes,
      });
    };

    return (
      <div className="card mt-3 mb-4">
        <div className="card-header">
          {t('page_me_access_token.form.title')}
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="mb-3">
              <label htmlFor="expiredAt" className="form-label">
                {t('page_me_access_token.expiredAt')}
              </label>
              <div className="row">
                <div className="col-16 col-sm-4 col-md-4 col-lg-3">
                  <div className="input-group">
                    <input
                      type="date"
                      className={`form-control ${errors.expiredAt ? 'is-invalid' : ''}`}
                      data-testid="grw-accesstoken-input-expiredAt"
                      min={todayStr}
                      {...register('expiredAt', {
                        required: t('input_validation.message.required', {
                          param: t('page_me_access_token.expiredAt'),
                        }),
                      })}
                    />
                  </div>
                  {errors.expiredAt && (
                    <div className="invalid-feedback d-block">
                      {errors.expiredAt.message}
                    </div>
                  )}
                </div>
              </div>
              <div className="form-text">
                {t('page_me_access_token.form.expiredAt_desc')}
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="description" className="form-label">
                {t('page_me_access_token.description')}
              </label>
              <textarea
                className={`form-control ${errors.description ? 'is-invalid' : ''}`}
                rows={3}
                data-testid="grw-accesstoken-textarea-description"
                {...register('description', {
                  required: t('input_validation.message.required', {
                    param: t('page_me_access_token.description'),
                  }),
                  maxLength: {
                    value: MAX_DESCRIPTION_LENGTH,
                    message: t(
                      'page_me_access_token.form.description_max_length',
                      { length: MAX_DESCRIPTION_LENGTH },
                    ),
                  },
                })}
              />
              {errors.description && (
                <div className="invalid-feedback">
                  {errors.description.message}
                </div>
              )}
              <div className="form-text">
                {t('page_me_access_token.form.description_desc')}
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="scopes" className="form-label">
                {t('page_me_access_token.scope')}
              </label>
              <AccessTokenScopeSelect
                selectedScopes={watch('scopes')}
                register={register('scopes', {
                  required: t('input_validation.message.required', {
                    param: t('page_me_access_token.scope'),
                  }),
                })}
              />
              {errors.scopes && (
                <div className="invalid-feedback">{errors.scopes.message}</div>
              )}

              <div className="form-text mb-2">
                {t('page_me_access_token.form.scope_desc')}
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              data-testid="grw-accesstoken-create-button"
              disabled={!isValid}
            >
              {t('page_me_access_token.create_token')}
            </button>
          </form>
        </div>
      </div>
    );
  },
);
AccessTokenForm.displayName = 'AccessTokenForm';
