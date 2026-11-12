import { forwardRef } from 'react';

import type { UsernameTypeaheadOwnProps } from '~/client/components/UsernameTypeahead';
import { UsernameTypeahead } from '~/client/components/UsernameTypeahead';
import type { IClearable } from '~/client/interfaces/clearable';

import { useRegisteredUsernameSuggestions } from './use-registered-username-suggestions';

/**
 * The username typeahead for the search page, wired to the registered-user
 * suggestion source.
 *
 * That source, not the audit-log one: this page is open to any logged-in user
 * while `/activity/suggestions` is adminRequired. Fixing it here — rather than
 * letting the panel choose — is what makes the 403 unreachable.
 *
 * `placeholder` stays a caller prop (no default): the page renders this twice,
 * for author and editor, with a different placeholder each time.
 */
export const SearchUsernameTypeahead = forwardRef<
  IClearable,
  UsernameTypeaheadOwnProps
>((props, ref) => (
  <UsernameTypeahead
    {...props}
    ref={ref}
    useUsernameSuggestions={useRegisteredUsernameSuggestions}
  />
));

SearchUsernameTypeahead.displayName = 'SearchUsernameTypeahead';
