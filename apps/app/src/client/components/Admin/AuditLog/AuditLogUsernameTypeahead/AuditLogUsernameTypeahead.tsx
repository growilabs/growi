import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { UsernameTypeaheadOwnProps } from '~/client/components/UsernameTypeahead';
import { UsernameTypeahead } from '~/client/components/UsernameTypeahead';
import type { IClearable } from '~/client/interfaces/clearable';

import { useAuditLogUsernameSuggestions } from './use-auditlog-username-suggestions';

/**
 * The username typeahead for the admin audit-log screens, wired to the
 * admin-only suggestion source.
 *
 * `forwardRef` is load-bearing: `AuditLogManagement`'s clear button reaches the
 * inner typeahead through this ref, and a plain function component here would
 * make React drop it silently — no warning, no type error, the input just stops
 * clearing (covered by the spec next to this file).
 */
export const AuditLogUsernameTypeahead = forwardRef<
  IClearable,
  UsernameTypeaheadOwnProps
>((props, ref) => {
  const { placeholder, ...rest } = props;
  const { t } = useTranslation();

  return (
    <UsernameTypeahead
      {...rest}
      ref={ref}
      // Defaulted here, not in the shared component: this key lives in the
      // `admin` namespace, which only these screens load.
      placeholder={placeholder ?? t('admin:audit_log_management.username')}
      useUsernameSuggestions={useAuditLogUsernameSuggestions}
    />
  );
});

AuditLogUsernameTypeahead.displayName = 'AuditLogUsernameTypeahead';
