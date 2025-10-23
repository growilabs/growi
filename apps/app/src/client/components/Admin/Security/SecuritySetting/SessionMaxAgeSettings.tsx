import React from 'react';

import type { UseFormRegister } from 'react-hook-form';

type Props = {
  register: UseFormRegister<{ sessionMaxAge: string }>;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export const SessionMaxAgeSettings: React.FC<Props> = ({ register, t }) => {
  return (
    <>
      <h4>{t('security_settings.session')}</h4>
      <div className="row">
        <label className="text-start text-md-end col-md-3 col-form-label">
          {t('security_settings.max_age')}
        </label>
        <div className="col-md-8">
          <input
            className="form-control col-md-4"
            type="text"
            {...register('sessionMaxAge')}
            placeholder="2592000000"
          />
          {/* eslint-disable-next-line react/no-danger */}
          <p className="form-text text-muted" dangerouslySetInnerHTML={{ __html: t('security_settings.max_age_desc') }} />
          <p className="card custom-card bg-warning-subtle">
            <span className="text-warning">
              <span className="material-symbols-outlined">info</span> {t('security_settings.max_age_caution')}
            </span>
          </p>
        </div>
      </div>
    </>
  );
};
