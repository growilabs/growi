import React, { useCallback, useEffect, useState } from 'react';
import {
  defaultSupportedCommandsNameForBroadcastUse,
  defaultSupportedCommandsNameForSingleUse,
  defaultSupportedSlackEventActions,
} from '@growi/slack';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:SlackIntegration:ManageCommandsProcess');

const PermissionTypes = {
  ALLOW_ALL: 'allowAll',
  DENY_ALL: 'denyAll',
  ALLOW_SPECIFIED: 'allowSpecified',
};

const defaultCommandsName = [
  ...defaultSupportedCommandsNameForBroadcastUse,
  ...defaultSupportedCommandsNameForSingleUse,
];

// A utility function that returns the new state but identical to the previous state
const getUpdatedChannelsList = (commandPermissionObj, commandName, value) => {
  // string to array
  const allowedChannelsArray = value.split(',');
  // trim whitespace from all elements
  const trimedAllowedChannelsArray = allowedChannelsArray.map((channelName) =>
    channelName.trim(),
  );

  commandPermissionObj[commandName] = trimedAllowedChannelsArray;
  return commandPermissionObj;
};

// A utility function that returns the new state
const getUpdatedPermissionSettings = (
  commandPermissionObj,
  commandName,
  value,
) => {
  const editedCommandPermissionObj = { ...commandPermissionObj };
  switch (value) {
    case PermissionTypes.ALLOW_ALL:
      editedCommandPermissionObj[commandName] = true;
      break;
    case PermissionTypes.DENY_ALL:
      editedCommandPermissionObj[commandName] = false;
      break;
    case PermissionTypes.ALLOW_SPECIFIED:
      editedCommandPermissionObj[commandName] = [];
      break;
    default:
      logger.error('Not implemented');
      break;
  }
  return editedCommandPermissionObj;
};

const SinglePermissionSettingComponent = ({
  commandName,
  editingCommandPermission,
  onPermissionTypeClicked,
  onPermissionListChanged,
}) => {
  const { t } = useTranslation();

  if (editingCommandPermission == null) {
    return null;
  }

  function permissionTypeClickHandler(e) {
    if (onPermissionTypeClicked == null) {
      return;
    }
    onPermissionTypeClicked(e);
  }

  function onPermissionListChangeHandler(e) {
    if (onPermissionListChanged == null) {
      return;
    }
    onPermissionListChanged(e);
  }

  const permission = editingCommandPermission[commandName];
  const hiddenClass = Array.isArray(permission) ? '' : 'd-none';
  const textareaDefaultValue = Array.isArray(permission)
    ? permission.join(',')
    : '';

  return (
    <div className="my-1 mb-2">
      <div className="row align-items-center mb-3">
        <p className="col my-auto text-capitalize align-middle">
          {commandName}
        </p>
        <div className="col dropdown">
          <button
            className="btn btn-outline-secondary dropdown-toggle text-end col-12 col-md-auto"
            type="button"
            id="dropdownMenuButton"
            data-bs-toggle="dropdown"
            aria-haspopup="true"
            aria-expanded="true"
          >
            <span className="float-start">
              {permission === true &&
                t('admin:slack_integration.accordion.allow_all')}
              {permission === false &&
                t('admin:slack_integration.accordion.deny_all')}
              {Array.isArray(permission) &&
                t('admin:slack_integration.accordion.allow_specified')}
            </span>
          </button>
          <div className="dropdown-menu">
            <button
              className="dropdown-item"
              type="button"
              name={commandName}
              value={PermissionTypes.ALLOW_ALL}
              onClick={(e) => permissionTypeClickHandler(e)}
            >
              {t('admin:slack_integration.accordion.allow_all_long')}
            </button>
            <button
              className="dropdown-item"
              type="button"
              name={commandName}
              value={PermissionTypes.DENY_ALL}
              onClick={(e) => permissionTypeClickHandler(e)}
            >
              {t('admin:slack_integration.accordion.deny_all_long')}
            </button>
            <button
              className="dropdown-item"
              type="button"
              name={commandName}
              value={PermissionTypes.ALLOW_SPECIFIED}
              onClick={(e) => permissionTypeClickHandler(e)}
            >
              {t('admin:slack_integration.accordion.allow_specified_long')}
            </button>
          </div>
        </div>
      </div>
      <div className={`row-12 row-md-6 ${hiddenClass}`}>
        <textarea
          className="form-control"
          type="textarea"
          name={commandName}
          value={textareaDefaultValue}
          onChange={(e) => onPermissionListChangeHandler(e)}
        />
        <p className="form-text text-muted small">
          {t('admin:slack_integration.accordion.allowed_channels_description', {
            commandName,
          })}
          <br />
        </p>
      </div>
    </div>
  );
};

SinglePermissionSettingComponent.propTypes = {
  commandName: PropTypes.string,
  editingCommandPermission: PropTypes.object,
  onPermissionTypeClicked: PropTypes.func,
  onPermissionListChanged: PropTypes.func,
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
const ManageCommandsProcessWithoutProxy = ({
  commandPermission,
  eventActionsPermission,
}) => {
  const { t } = useTranslation();
  const [editingCommandPermission, setEditingCommandPermission] = useState({});
  const [editingEventActionsPermission, setEditingEventActionsPermission] =
    useState({});

  useEffect(() => {
    if (commandPermission == null) {
      return;
    }
    const updatedState = { ...commandPermission };
    setEditingCommandPermission(updatedState);
  }, [commandPermission]);

  useEffect(() => {
    if (eventActionsPermission == null) {
      return;
    }
    const updatedState = { ...eventActionsPermission };
    setEditingEventActionsPermission(updatedState);
  }, [eventActionsPermission]);

  const updatePermissionsCommandsState = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setEditingCommandPermission((commandPermissionObj) =>
      getUpdatedPermissionSettings(commandPermissionObj, commandName, value),
    );
  }, []);

  const updatePermissionsEventsState = useCallback((e) => {
    const { target } = e;
    const { name: actionName, value } = target;
    setEditingEventActionsPermission((eventActionPermissionObj) =>
      getUpdatedPermissionSettings(eventActionPermissionObj, actionName, value),
    );
  }, []);

  const updateCommandsChannelsListState = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setEditingCommandPermission((commandPermissionObj) => ({
      ...getUpdatedChannelsList(commandPermissionObj, commandName, value),
    }));
  }, []);

  const updateEventsChannelsListState = useCallback((e) => {
    const { target } = e;
    const { name: actionName, value } = target;
    setEditingEventActionsPermission((eventActionPermissionObj) => ({
      ...getUpdatedChannelsList(eventActionPermissionObj, actionName, value),
    }));
  }, []);

  const updateCommandsHandler = async (e) => {
    try {
      await apiv3Put(
        '/slack-integration-settings/without-proxy/update-permissions',
        {
          commandPermission: editingCommandPermission,
          eventActionsPermission: editingEventActionsPermission,
        },
      );
      toastSuccess(
        t('toaster.update_successed', {
          target: 'the permission for commands',
          ns: 'commons',
        }),
      );
    } catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  return (
    <div className="py-4 px-5">
      <p className="mb-4 fw-bold">
        {t('admin:slack_integration.accordion.growi_commands')}
      </p>
      <div className="row d-flex flex-column align-items-center">
        <div className="col-8">
          <div className="form-check">
            <div className="row mb-5 d-block">
              {defaultCommandsName.map((commandName) => {
                return (
                  <SinglePermissionSettingComponent
                    key={`${commandName}-component`}
                    commandName={commandName}
                    editingCommandPermission={editingCommandPermission}
                    onPermissionTypeClicked={updatePermissionsCommandsState}
                    onPermissionListChanged={updateCommandsChannelsListState}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="mb-4 fw-bold">Events</p>
      <div className="row d-flex flex-column align-items-center">
        <div className="col-8">
          <div className="form-check">
            <div className="row mb-5 d-block">
              {defaultSupportedSlackEventActions.map((actionName) => (
                <SinglePermissionSettingComponent
                  key={`${actionName}-component`}
                  commandName={actionName}
                  editingCommandPermission={editingEventActionsPermission}
                  onPermissionTypeClicked={updatePermissionsEventsState}
                  onPermissionListChanged={updateEventsChannelsListState}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        <button
          type="submit"
          className="btn btn-primary mx-auto"
          onClick={updateCommandsHandler}
        >
          {t('Update')}
        </button>
      </div>
    </div>
  );
};

ManageCommandsProcessWithoutProxy.propTypes = {
  commandPermission: PropTypes.object,
  eventActionsPermission: PropTypes.object,
};

export default ManageCommandsProcessWithoutProxy;
