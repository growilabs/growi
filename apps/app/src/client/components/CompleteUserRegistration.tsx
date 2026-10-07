import type { FC } from 'react';
import React from 'react';
import { useTranslation } from 'next-i18next';

export const CompleteUserRegistration: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="nologin-dialog mx-auto" id="nologin-dialog">
      <div className="row mx-0">
        <div className="col-12 mb-3 text-center">
          <p className="alert alert-success">
            <span>{t('login.registration_successful')}</span>
          </p>
          {/* If the transition source is "/login", use <a /> tag since the transition will not occur if next/link is used. */}
          <a href="/login">
            <span className="material-symbols-outlined">login</span>
            {t('Sign in is here')}
          </a>
        </div>
      </div>
    </div>
  );
};
