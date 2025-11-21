import React from 'react';

import type { Scope } from '@growi/core/dist/interfaces';
import { useTranslation } from 'next-i18next';
import type { UseFormRegisterReturn } from 'react-hook-form';

import { useDeviceLargerThanMd } from '~/states/ui/device';


import styles from './AccessTokenScopeList.module.scss';

const moduleClass = styles['access-token-scope-list'] ?? '';

interface scopeObject {
  [key: string]: Scope | scopeObject;
}

interface AccessTokenScopeListProps {
  scopeObject: scopeObject;
  register: UseFormRegisterReturn<'scopes'>;
  disabledScopes: Set<Scope>
  level?: number;
}

/**
 * Renders the permission object recursively as nested checkboxes.
 */
export const AccessTokenScopeList: React.FC<AccessTokenScopeListProps> = ({
  scopeObject,
  register,
  disabledScopes,
  level = 1,
}) => {

  const [isDeviceLargerThanMd] = useDeviceLargerThanMd();

  // Convert object into an array to determine "first vs. non-first" elements
  const entries = Object.entries(scopeObject);
  const { t } = useTranslation('commons');

  return (
    <>
      {entries.map(([scopeKey, scopeValue], idx) => {
        const showHr = (level === 1 || level === 2) && idx !== 0;

        if (typeof scopeValue === 'object') {
          return (
            <div key={scopeKey} className={moduleClass}>
              {showHr && <hr className="my-1" />}
              <div className="my-1 row">
                <div className="col-md-5 ">
                  <label className={`form-check-label fw-bold indentation indentation-level-${level}`}>{scopeKey}</label>
                </div>
              </div>

              {/* Render recursively */}
              <AccessTokenScopeList
                scopeObject={scopeValue as scopeObject}
                register={register}
                level={level + 1}
                disabledScopes={disabledScopes}
              />
            </div>
          );
        }
        // If it's a string, render a checkbox
        return (
          <div key={scopeKey} className={`row my-1 ${moduleClass}`}>
            <div className="col-md-5 indentation">
              <input
                data-testid={`grw-accesstoken-checkbox-${scopeValue}`}
                className={`form-check-input indentation indentation-level-${level}`}
                type="checkbox"
                id={scopeValue as string}
                disabled={disabledScopes.has(scopeValue)}
                value={scopeValue as string}
                {...register}
              />
              <label className="form-check-label ms-2" htmlFor={scopeValue as string}>
                {scopeKey}
              </label>
            </div>
            <div className={`col form-text ${isDeviceLargerThanMd ? '' : 'text-end'}`}>{t(`accesstoken_scopes_desc.${scopeKey.replace(/:/g, '.')}`)}</div>
          </div>
        );
      })}
    </>
  );
};
