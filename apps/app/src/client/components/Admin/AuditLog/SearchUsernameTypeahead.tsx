import type { ForwardRefRenderFunction } from 'react';
import React, {
  Fragment,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { TypeaheadRef } from 'react-bootstrap-typeahead';
import { AsyncTypeahead, Menu, MenuItem } from 'react-bootstrap-typeahead';
import { useTranslation } from 'react-i18next';

import type { IClearable } from '~/client/interfaces/clearable';
import { useSWRxAuditlogUsernames } from '~/stores/activity';
import { useSWRxUsernames } from '~/stores/user';

const Categories = {
  activeUser: 'Active User',
  inactiveUser: 'Inactive User',
  activitySnapshotUser: 'Activity Snapshot User',
} as const;

type CategoryType = (typeof Categories)[keyof typeof Categories];

type UserDataType = {
  username: string;
  category: CategoryType;
};

type Props = {
  onChange: (text: string[]) => void;
  initialUsernames?: string[];
};

const SearchUsernameTypeaheadSubstance: ForwardRefRenderFunction<
  IClearable,
  Props
> = (props: Props, ref) => {
  const { onChange, initialUsernames } = props;
  const { t } = useTranslation();

  const typeaheadRef = useRef<TypeaheadRef>(null);

  const toUserDataItem = (username: string): UserDataType => ({
    username,
    category: Categories.activeUser,
  });

  /*
   * State
   */
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<UserDataType[]>(() =>
    (initialUsernames ?? []).map(toUserDataItem),
  );

  /*
   * Fetch
   */
  const {
    data: usernameData,
    error: usernameError,
    isLoading: _isUsernameLoading,
  } = useSWRxUsernames(searchKeyword, 0, 5, {
    isIncludeActiveUser: true,
    isIncludeInactiveUser: true,
  });

  const {
    data: auditlogData,
    error: auditlogError,
    isLoading: _isAuditlogLoading,
  } = useSWRxAuditlogUsernames(searchKeyword, 0, 5);

  const activeUsernames = auditlogData?.activeUser?.usernames ?? [];
  const inactiveUsernames = auditlogData?.inactiveUser?.usernames ?? [];
  const activitySnapshotUsernames =
    auditlogData?.activitySnapshotUser?.usernames ?? [];

  const isLoading = _isAuditlogLoading === true && auditlogError == null;

  const allUser: UserDataType[] = [];
  const pushToAllUser = (usernames: string[], category: CategoryType) => {
    usernames.forEach((username) => {
      allUser.push({ username, category });
    });
  };
  pushToAllUser(activeUsernames, Categories.activeUser);
  pushToAllUser(inactiveUsernames, Categories.inactiveUser);
  pushToAllUser(activitySnapshotUsernames, Categories.activitySnapshotUser);

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

  const renderMenu = useCallback((allUser: UserDataType[], menuProps) => {
    if (allUser == null || allUser.length === 0) {
      return <></>;
    }

    let index = 0;
    const items = Object.values(Categories).map((category) => {
      const userData = allUser.filter((user) => user.category === category);
      return (
        <Fragment key={category}>
          {index !== 0 && <Menu.Divider />}
          <Menu.Header>{category}</Menu.Header>
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
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
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
        id="search-username-typeahead-asynctypeahead"
        multiple
        delay={400}
        minLength={0}
        placeholder={t('admin:audit_log_management.username')}
        isLoading={isLoading}
        options={allUser}
        selected={selectedItems}
        onSearch={searchHandler}
        onChange={changeHandler}
        renderMenu={renderMenu}
        labelKey={(option: UserDataType) => `${option.username}`}
        filterBy={() => true}
      />
    </div>
  );
};

export const SearchUsernameTypeahead = forwardRef(
  SearchUsernameTypeaheadSubstance,
);
