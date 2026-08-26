import type { ForwardRefRenderFunction } from 'react';
import React, {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { TypeaheadRef } from 'react-bootstrap-typeahead';
import { AsyncTypeahead, Menu, MenuItem } from 'react-bootstrap-typeahead';
import { useTranslation } from 'react-i18next';

import type { IClearable } from '~/client/interfaces/clearable';

import { shouldShowUsernameSuggestion } from './should-show-username-suggestion';
import type { UseUsernameSuggestions } from './username-suggestions';

// Grouping keys, not display text — `renderMenu` groups options by them and
// `toUserDataItem` defaults to one, so the values are load-bearing.
const Categories = {
  activeUser: 'activeUser',
  inactiveUser: 'inactiveUser',
} as const;

type CategoryType = (typeof Categories)[keyof typeof Categories];

// Must be `commons`: admin pages load ['admin'] and the search page loads
// ['translation'], so it is the only namespace both get (see
// pages/common-props/i18n.ts). Anywhere else renders raw keys on half the callers.
// Exported for the locale-drift spec only — deliberately kept out of the
// barrel, so it stays an internal of this module for every other caller.
export const CATEGORY_LABEL_KEYS = {
  [Categories.activeUser]: 'commons:username_suggestion.active_user',
  [Categories.inactiveUser]: 'commons:username_suggestion.inactive_user',
} as const satisfies Record<CategoryType, string>;

type UserDataType = {
  username: string;
  category: CategoryType;
};

// Selection only tracks usernames, so the category of a re-hydrated item is
// unknown; activeUser is a harmless default (category is not shown on tokens).
const toUserDataItem = (username: string): UserDataType => ({
  username,
  category: Categories.activeUser,
});

export type UsernameTypeaheadProps = {
  onChange: (text: string[]) => void;
  // Required, not defaulted — see `UseUsernameSuggestions`.
  useUsernameSuggestions: UseUsernameSuggestions;
  initialUsernames?: string[];
  // Passed straight through, never defaulted here: any default would have to
  // name an i18n namespace, and no single namespace is loaded by every caller
  // (admin pages load ['admin'], the search page ['translation']). The
  // per-screen wrapper components own that default instead.
  placeholder?: string;
  // Must be unique per instance: rendering this typeahead more than once on a
  // page (e.g. author + editor filters) would otherwise duplicate the DOM id.
  id?: string;
};

/**
 * What a per-screen wrapper accepts and forwards: everything except the
 * suggestion source, which each wrapper fixes to its own endpoint.
 *
 * Named here so the two wrappers share one definition — the `Omit` written out
 * at each of them would have to be edited twice whenever these props change.
 */
export type UsernameTypeaheadOwnProps = Omit<
  UsernameTypeaheadProps,
  'useUsernameSuggestions'
>;

const UsernameTypeaheadSubstance: ForwardRefRenderFunction<
  IClearable,
  UsernameTypeaheadProps
> = (props: UsernameTypeaheadProps, ref) => {
  const {
    onChange,
    useUsernameSuggestions,
    initialUsernames,
    placeholder,
    id,
  } = props;
  const { t } = useTranslation();

  const typeaheadRef = useRef<TypeaheadRef>(null);

  /*
   * State
   */
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<UserDataType[]>(() =>
    (initialUsernames ?? []).map(toUserDataItem),
  );

  // Reflect external `initialUsernames` changes (e.g. a chips-bar clear or URL
  // rehydrate) into the shown selection. Guarded to the actual username set so
  // the fresh-array reference produced by our own onChange round-trip does not
  // needlessly rebuild the tokens.
  useEffect(() => {
    setSelectedItems((prev) => {
      const next = initialUsernames ?? [];
      const prevNames = prev.map((item) => item.username);
      const isSame =
        prevNames.length === next.length &&
        prevNames.every((name, i) => name === next[i]);
      return isSame ? prev : next.map(toUserDataItem);
    });
  }, [initialUsernames]);

  /*
   * Fetch
   */
  const { activeUsernames, inactiveUsernames, isLoading } =
    useUsernameSuggestions(searchKeyword);

  const allUser: UserDataType[] = [
    ...activeUsernames.map((username) => ({
      username,
      category: Categories.activeUser,
    })),
    ...inactiveUsernames.map((username) => ({
      username,
      category: Categories.inactiveUser,
    })),
  ];

  /*
   * Functions
   */
  const changeHandler = useCallback(
    (userData: UserDataType[]) => {
      setSelectedItems(userData);
      const usernames = userData.map((user) => user.username);
      onChange(usernames);
    },
    [onChange],
  );

  const searchHandler = useCallback((text: string) => {
    setSearchKeyword(text);
  }, []);

  const filterBy = useCallback(
    (option: UserDataType, { text }: { text: string }) =>
      shouldShowUsernameSuggestion({
        option,
        currentText: text,
        fetchedForKeyword: searchKeyword,
        selectedUsernames: selectedItems.map((s) => s.username),
      }),
    [searchKeyword, selectedItems],
  );

  const renderMenu = useCallback(
    (allUser: UserDataType[], menuProps) => {
      if (allUser == null || allUser.length === 0) {
        return <></>;
      }

      let index = 0;
      const items = Object.values(Categories).map((category) => {
        const userData = allUser.filter((user) => user.category === category);

        if (userData.length === 0) {
          return [];
        }
        const isFirstGroup = index === 0;

        return (
          <Fragment key={category}>
            {!isFirstGroup && <Menu.Divider />}
            <Menu.Header>{t(CATEGORY_LABEL_KEYS[category])}</Menu.Header>
            {userData.map((user) => {
              const item = (
                <MenuItem key={index} option={user} position={index}>
                  {user.username}
                </MenuItem>
              );
              index++;
              return item;
            })}
          </Fragment>
        );
      });

      return <Menu {...menuProps}>{items}</Menu>;
    },
    [t],
  );

  useImperativeHandle(ref, () => ({
    clear() {
      // Our own selection has to be reset too, not just the inner typeahead's:
      // `instance.clear()` only empties the library's internal copy and never
      // calls `onChange`, so `selected` would still hold the old tokens on the
      // next render — and the library re-syncs state from that prop whenever it
      // differs (componentDidUpdate), putting the cleared tokens straight back.
      setSelectedItems([]);

      const instance = typeaheadRef?.current;
      if (instance != null) {
        instance.clear();
      }
    },
  }));

  return (
    <div className="input-group me-2">
      <span className="input-group-text">
        <span className="material-symbols-outlined">person</span>
      </span>
      <AsyncTypeahead
        ref={typeaheadRef}
        id={id ?? 'username-typeahead-asynctypeahead'}
        multiple
        delay={400}
        minLength={0}
        filterBy={filterBy}
        placeholder={placeholder}
        isLoading={isLoading}
        options={allUser}
        selected={selectedItems}
        onSearch={searchHandler}
        onChange={changeHandler}
        renderMenu={renderMenu}
        labelKey={(option: UserDataType) => `${option.username}`}
      />
    </div>
  );
};

export const UsernameTypeahead = forwardRef(UsernameTypeaheadSubstance);
