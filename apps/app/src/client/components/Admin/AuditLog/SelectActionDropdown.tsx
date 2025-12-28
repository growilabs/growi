import type { FC } from 'react';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  SupportedActionCategoryType,
  SupportedActionType,
} from '~/interfaces/activity';
import {
  AdminActions,
  AttachmentActions,
  CommentActions,
  InAppNotificationActions,
  PageActions,
  SearchActions,
  ShareLinkActions,
  SupportedActionCategory,
  TagActions,
  UserActions,
} from '~/interfaces/activity';

type Props = {
  actionMap: Map<SupportedActionType, boolean>;
  availableActions: SupportedActionType[];
  onChangeAction: (action: SupportedActionType) => void;
  onChangeMultipleAction: (
    actions: SupportedActionType[],
    isChecked: boolean,
  ) => void;
};

export const SelectActionDropdown: FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const {
    actionMap,
    availableActions,
    onChangeAction,
    onChangeMultipleAction,
  } = props;

  const dropdownItems = useMemo<
    Array<{
      actionCategory: SupportedActionCategoryType;
      actions: SupportedActionType[];
    }>
  >(() => {
    return [
      {
        actionCategory: SupportedActionCategory.PAGE,
        actions: PageActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.COMMENT,
        actions: CommentActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.TAG,
        actions: TagActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.ATTACHMENT,
        actions: AttachmentActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.SHARE_LINK,
        actions: ShareLinkActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.IN_APP_NOTIFICATION,
        actions: InAppNotificationActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.SEARCH,
        actions: SearchActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.USER,
        actions: UserActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
      {
        actionCategory: SupportedActionCategory.ADMIN,
        actions: AdminActions.filter((action) =>
          availableActions.includes(action),
        ),
      },
    ];
  }, [availableActions]).filter((item) => item.actions.length !== 0);

  const actionCheckboxChangedHandler = useCallback(
    (action) => {
      if (onChangeAction != null) {
        onChangeAction(action);
      }
    },
    [onChangeAction],
  );

  const multipleActionCheckboxChangedHandler = useCallback(
    (actions, isChecked) => {
      if (onChangeMultipleAction != null) {
        onChangeMultipleAction(actions, isChecked);
      }
    },
    [onChangeMultipleAction],
  );

  return (
    <div className="btn-group me-2 admin-audit-log">
      <button
        className="btn btn-outline-secondary dropdown-toggle"
        type="button"
        id="dropdownMenuButton"
        data-bs-toggle="dropdown"
      >
        <span className="material-symbols-outlined me-1">bolt</span>
        {t('admin:audit_log_management.action')}
      </button>
      <ul
        className="dropdown-menu select-action-dropdown"
        aria-labelledby="dropdownMenuButton"
      >
        {dropdownItems.map((item) => (
          <div key={item.actionCategory}>
            <div className="dropdown-item">
              <div className="px-2 m-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  defaultChecked
                  onChange={(e) => {
                    multipleActionCheckboxChangedHandler(
                      item.actions,
                      e.target.checked,
                    );
                  }}
                />
                <label className="form-label form-check-label">
                  {t(`admin:audit_log_action_category.${item.actionCategory}`)}
                </label>
              </div>
            </div>
            {item.actions.map((action) => (
              <div className="dropdown-item" key={action}>
                <div className="px-4 m-0">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id={`checkbox${action}`}
                    onChange={() => {
                      actionCheckboxChangedHandler(action);
                    }}
                    checked={actionMap.get(action)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`checkbox${action}`}
                  >
                    {t(`admin:audit_log_action.${action}`)}
                  </label>
                </div>
              </div>
            ))}
          </div>
        ))}
      </ul>
    </div>
  );
};
