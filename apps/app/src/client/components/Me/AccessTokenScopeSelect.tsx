import React, { useEffect, useState, useMemo } from 'react';

import type { Scope } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import type { UseFormRegisterReturn } from 'react-hook-form';

import { extractScopes, getDisabledScopes, parseScopes } from '~/client/util/scope-util';
import { useIsAdmin } from '~/stores-universal/context';

import { AccessTokenScopeList } from './AccessTokenScopeList';

/**
 * Props for AccessTokenScopeSelect
 */
type AccessTokenScopeSelectProps = {
  /** React Hook Form's register function for a field named "scopes" */
  register: UseFormRegisterReturn<'scopes'>;
  selectedScopes: Scope[];
};

/**
 * Displays a list of permissions in a recursive, nested checkbox interface.
 */
export const AccessTokenScopeSelect: React.FC<AccessTokenScopeSelectProps> = ({ register, selectedScopes }) => {
  const [disabledScopes, setDisabledScopes] = useState<Set<Scope>>(new Set());
  const { data: isAdmin } = useIsAdmin();

  const ScopesMap = useMemo(() => parseScopes({ scopes: SCOPE, isAdmin }), [isAdmin]);
  const extractedScopes = useMemo(() => extractScopes(ScopesMap), [ScopesMap]);

  useEffect(() => {
    const disabledSet = getDisabledScopes(selectedScopes, extractedScopes);
    setDisabledScopes(disabledSet);
  }, [selectedScopes, extractedScopes]);

  return (
    <div className="border rounded">
      <AccessTokenScopeList scopeObject={ScopesMap} register={register} disabledScopes={disabledScopes} />
    </div>
  );
};
