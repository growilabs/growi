import type { FC } from 'react';
import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';

import { useTranslation } from 'react-i18next';

import type { SupportedActionType, SupportedActionCategoryType } from '~/interfaces/activity';
import {
  SupportedActionCategory,
  PageActions, CommentActions, TagActions, ShareLinkActions, AttachmentActions, InAppNotificationActions, SearchActions, UserActions, AdminActions,
} from '~/interfaces/activity';

type Props = {
  actionMap: Map<SupportedActionType, boolean>
  availableActions: SupportedActionType[]
  onChangeAction: (action: SupportedActionType) => void
  onChangeMultipleAction: (actions: SupportedActionType[], isChecked: boolean) => void
}

export const SelectActionDropdown: FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const {
    actionMap, availableActions, onChangeAction, onChangeMultipleAction,
  } = props;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const dropdownItems = useMemo<Array<{actionCategory: SupportedActionCategoryType, actions: SupportedActionType[]}>>(() => {
    return (
      [
        {
          actionCategory: SupportedActionCategory.PAGE,
          actions: PageActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.COMMENT,
          actions: CommentActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.TAG,
          actions: TagActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.ATTACHMENT,
          actions: AttachmentActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.SHARE_LINK,
          actions: ShareLinkActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.IN_APP_NOTIFICATION,
          actions: InAppNotificationActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.SEARCH,
          actions: SearchActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.USER,
          actions: UserActions.filter(action => availableActions.includes(action)),
        },
        {
          actionCategory: SupportedActionCategory.ADMIN,
          actions: AdminActions.filter(action => availableActions.includes(action)),
        },
      ]
    );
  }, [availableActions]).filter(item => item.actions.length !== 0);

  const actionCheckboxChangedHandler = useCallback((action) => {
    if (onChangeAction != null) {
      onChangeAction(action);
    }
  }, [onChangeAction]);

  const multipleActionCheckboxChangedHandler = useCallback((actions, isChecked) => {
    if (onChangeMultipleAction != null) {
      onChangeMultipleAction(actions, isChecked);
    }
  }, [onChangeMultipleAction]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const toggleDropdown = useCallback(() => {
    setIsDropdownOpen(!isDropdownOpen);
  }, [isDropdownOpen]);

  return (
    <div className="btn-group me-2 admin-audit-log" ref={dropdownRef}>
      <button 
        className="btn btn-outline-secondary dropdown-toggle" 
        type="button" 
        onClick={toggleDropdown}
      >
        <span className="material-symbols-outlined me-1">bolt</span>{t('admin:audit_log_management.action')}
      </button>
      <ul className={`dropdown-menu select-action-dropdown ${isDropdownOpen ? 'show' : ''}`} onClick={(e) => e.stopPropagation()}>
        {dropdownItems.map(item => (
          <div key={item.actionCategory}>
            <div className="dropdown-item" onClick={(e) => e.stopPropagation()}>
              <div className="px-2 m-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  defaultChecked
                  onChange={(e) => { multipleActionCheckboxChangedHandler(item.actions, e.target.checked) }}
                />
                <label className="form-label form-check-label">{t(`admin:audit_log_action_category.${item.actionCategory}`)}</label>
              </div>
            </div>
            {
              item.actions.map(action => (
                <div className="dropdown-item" key={action} onClick={(e) => e.stopPropagation()}>
                  <div className="px-4 m-0">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      id={`checkbox${action}`}
                      onChange={() => { actionCheckboxChangedHandler(action) }}
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
              ))
            }
          </div>
        ))}
      </ul>
    </div>
  );
};
