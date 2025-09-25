import React, { useCallback, useState } from 'react';

import { defaultSupportedCommandsNameForBroadcastUse, defaultSupportedCommandsNameForSingleUse, defaultSupportedSlackEventActions } from '@growi/slack';
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

const CommandUsageTypes = {
  BROADCAST_USE: 'broadcastUse',
  SINGLE_USE: 'singleUse',
};

const EventTypes = {
  LINK_SHARING: 'linkSharing',
};


// A utility function that returns the new state but identical to the previous state
const getUpdatedChannelsList = (prevState, commandName, value) => {
  // string to array
  const allowedChannelsArray = value.split(',');
  // trim whitespace from all elements
  const trimedAllowedChannelsArray = allowedChannelsArray.map(channelName => channelName.trim());

  prevState[commandName] = trimedAllowedChannelsArray;
  return prevState;
};

// A utility function that returns the new state
const getUpdatedPermissionSettings = (prevState, commandName, value) => {
  const newState = { ...prevState };
  switch (value) {
    case PermissionTypes.ALLOW_ALL:
      newState[commandName] = true;
      break;
    case PermissionTypes.DENY_ALL:
      newState[commandName] = false;
      break;
    case PermissionTypes.ALLOW_SPECIFIED:
      newState[commandName] = [];
      break;
    default:
      logger.error('Not implemented');
      break;
  }

  return newState;
};

// A utility function that returns the permission type from the permission value
const getPermissionTypeFromValue = (value) => {
  if (Array.isArray(value)) {
    return PermissionTypes.ALLOW_SPECIFIED;
  }
  if (typeof value === 'boolean') {
    return value ? PermissionTypes.ALLOW_ALL : PermissionTypes.DENY_ALL;
  }
  logger.error('The value type must be boolean or string[]');
};

const PermissionSettingForEachPermissionTypeComponent = ({
  keyName, onUpdatePermissions, onUpdateChannels, singleCommandDescription, allowedChannelsDescription, currentPermissionType, permissionSettings,
}) => {
  const { t } = useTranslation();
  const hiddenClass = currentPermissionType === PermissionTypes.ALLOW_SPECIFIED ? '' : 'd-none';

  const permission = permissionSettings[keyName];
  if (permission === undefined) logger.error('Must be implemented');
  const textareaDefaultValue = Array.isArray(permission) ? permission.join(',') : '';


  return (
    <div className="my-1 mb-2">
      <div className="row align-items-center mb-3">
        <p className="col-md-5 text-md-end mb-2">
          <strong className="text-capitalize">{keyName}</strong>
          {singleCommandDescription && (
            <small className="form-text text-muted small">
              { singleCommandDescription }
            </small>
          )}
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
              {currentPermissionType === PermissionTypes.ALLOW_ALL
              && t('admin:slack_integration.accordion.allow_all')}
              {currentPermissionType === PermissionTypes.DENY_ALL
              && t('admin:slack_integration.accordion.deny_all')}
              {currentPermissionType === PermissionTypes.ALLOW_SPECIFIED
              && t('admin:slack_integration.accordion.allow_specified')}
            </span>
          </button>
          <div className="dropdown-menu">
            <button
              className="dropdown-item"
              type="button"
              name={keyName}
              value={PermissionTypes.ALLOW_ALL}
              onClick={onUpdatePermissions}
            >
              {t('admin:slack_integration.accordion.allow_all_long')}
            </button>
            <button
              className="dropdown-item"
              type="button"
              name={keyName}
              value={PermissionTypes.DENY_ALL}
              onClick={onUpdatePermissions}
            >
              {t('admin:slack_integration.accordion.deny_all_long')}
            </button>
            <button
              className="dropdown-item"
              type="button"
              name={keyName}
              value={PermissionTypes.ALLOW_SPECIFIED}
              onClick={onUpdatePermissions}
            >
              {t('admin:slack_integration.accordion.allow_specified_long')}
            </button>
          </div>
        </div>
      </div>
      <div className={`row ${hiddenClass}`}>
        <div className="col-md-7 offset-md-5">
          <textarea
            className="form-control"
            type="textarea"
            name={keyName}
            value={textareaDefaultValue}
            onChange={onUpdateChannels}
          />
          <p className="form-text text-muted small">
            {t(allowedChannelsDescription, { keyName })}
          </p>
        </div>
      </div>
    </div>
  );
};

PermissionSettingForEachPermissionTypeComponent.propTypes = {
  keyName: PropTypes.string,
  usageType: PropTypes.string,
  currentPermissionType: PropTypes.string,
  singleCommandDescription: PropTypes.string,
  onUpdatePermissions: PropTypes.func,
  onUpdateChannels: PropTypes.func,
  allowedChannelsDescription: PropTypes.string,
  permissionSettings: PropTypes.object,
};


// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
const ManageCommandsProcess = ({
  slackAppIntegrationId, permissionsForBroadcastUseCommands, permissionsForSingleUseCommands, permissionsForSlackEventActions,
}) => {
  const { t } = useTranslation();

  const [permissionsForBroadcastUseCommandsState, setPermissionsForBroadcastUseCommandsState] = useState({
    search: permissionsForBroadcastUseCommands.search,
  });
  const [permissionsForSingleUseCommandsState, setPermissionsForSingleUseCommandsState] = useState({
    note: permissionsForSingleUseCommands.note,
    keep: permissionsForSingleUseCommands.keep,
  });
  const [permissionsForEventsState, setPermissionsForEventsState] = useState({
    unfurl: permissionsForSlackEventActions.unfurl,
  });
  const [currentPermissionTypes, setCurrentPermissionTypes] = useState(() => {
    const initialState = {};
    Object.entries(permissionsForBroadcastUseCommandsState).forEach((entry) => {
      const [commandName, value] = entry;
      initialState[commandName] = getPermissionTypeFromValue(value);
    });
    Object.entries(permissionsForSingleUseCommandsState).forEach((entry) => {
      const [commandName, value] = entry;
      initialState[commandName] = getPermissionTypeFromValue(value);
    });
    Object.entries(permissionsForEventsState).forEach((entry) => {
      const [commandName, value] = entry;
      initialState[commandName] = getPermissionTypeFromValue(value);
    });
    return initialState;
  });


  const handleUpdateSingleUsePermissions = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setPermissionsForSingleUseCommandsState(prev => getUpdatedPermissionSettings(prev, commandName, value));
    setCurrentPermissionTypes((prevState) => {
      const newState = { ...prevState };
      newState[commandName] = value;
      return newState;
    });
  }, []);

  const handleUpdateBroadcastUsePermissions = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setPermissionsForBroadcastUseCommandsState(prev => getUpdatedPermissionSettings(prev, commandName, value));
    setCurrentPermissionTypes((prevState) => {
      const newState = { ...prevState };
      newState[commandName] = value;
      return newState;
    });
  }, []);

  const handleUpdateEventsPermissions = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setPermissionsForEventsState(prev => getUpdatedPermissionSettings(prev, commandName, value));
    setCurrentPermissionTypes((prevState) => {
      const newState = { ...prevState };
      newState[commandName] = value;
      return newState;
    });
  }, []);

  const handleUpdateSingleUseChannels = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setPermissionsForSingleUseCommandsState(prev => getUpdatedChannelsList(prev, commandName, value));
  }, []);

  const handleUpdateBroadcastUseChannels = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setPermissionsForBroadcastUseCommandsState(prev => getUpdatedChannelsList(prev, commandName, value));
  }, []);

  const handleUpdateEventsChannels = useCallback((e) => {
    const { target } = e;
    const { name: commandName, value } = target;
    setPermissionsForEventsState(prev => getUpdatedChannelsList(prev, commandName, value));
  }, []);


  const updateSettingsHandler = async(e) => {
    try {
      // TODO: add new attribute 78975
      await apiv3Put(`/slack-integration-settings/slack-app-integrations/${slackAppIntegrationId}/permissions`, {
        permissionsForBroadcastUseCommands: permissionsForBroadcastUseCommandsState,
        permissionsForSingleUseCommands: permissionsForSingleUseCommandsState,
        permissionsForSlackEventActions: permissionsForEventsState,
      });
      toastSuccess(t('toaster.update_successed', { target: 'Token', ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
      logger.error(err);
    }
  };

  const PermissionSettingsForEachCategoryComponent = ({
    currentPermissionTypes,
    usageType,
    menuItem,
  }) => {
    const permissionMap = {
      broadcastUse: permissionsForBroadcastUseCommandsState,
      singleUse: permissionsForSingleUseCommandsState,
      linkSharing: permissionsForEventsState,
    };

    const {
      title,
      description,
      defaultCommandsName,
      singleCommandDescription,
      updatePermissionsHandler,
      updateChannelsHandler,
      allowedChannelsDescription,
    } = menuItem;

    return (
      <>
        {(title || description) && (
          <div className="row">
            <div className="col-md-7 offset-md-2">
              { title && <p className="fw-bold mb-1">{title}</p> }
              { description && <p className="text-muted">{description}</p> }
            </div>
          </div>
        )}

        <div className="form-check">
          <div className="row mb-5 d-block">
            {defaultCommandsName.map(keyName => (
              <PermissionSettingForEachPermissionTypeComponent
                key={`${keyName}-component`}
                keyName={keyName}
                usageType={usageType}
                permissionSettings={permissionMap[usageType]}
                currentPermissionType={currentPermissionTypes[keyName]}
                singleCommandDescription={singleCommandDescription}
                onUpdatePermissions={updatePermissionsHandler}
                onUpdateChannels={updateChannelsHandler}
                allowedChannelsDescription={allowedChannelsDescription}
              />
            ))}
          </div>
        </div>
      </>
    );
  };


  PermissionSettingsForEachCategoryComponent.propTypes = {
    currentPermissionTypes: PropTypes.object,
    usageType: PropTypes.string,
    menuItem: PropTypes.object,
  };

  // Using i18n in allowedChannelsDescription will cause interpolation error
  const menuMap = {
    broadcastUse: {
      title: 'Multiple GROWI',
      description: t('admin:slack_integration.accordion.multiple_growi_command'),
      defaultCommandsName: defaultSupportedCommandsNameForBroadcastUse,
      updatePermissionsHandler: handleUpdateBroadcastUsePermissions,
      updateChannelsHandler: handleUpdateBroadcastUseChannels,
      allowedChannelsDescription: 'admin:slack_integration.accordion.allowed_channels_description',
    },
    singleUse: {
      title: 'Single GROWI',
      description: t('admin:slack_integration.accordion.single_growi_command'),
      defaultCommandsName: defaultSupportedCommandsNameForSingleUse,
      updatePermissionsHandler: handleUpdateSingleUsePermissions,
      updateChannelsHandler: handleUpdateSingleUseChannels,
      allowedChannelsDescription: 'admin:slack_integration.accordion.allowed_channels_description',
    },
    linkSharing: {
      defaultCommandsName: defaultSupportedSlackEventActions,
      updatePermissionsHandler: handleUpdateEventsPermissions,
      updateChannelsHandler: handleUpdateEventsChannels,
      singleCommandDescription: t('admin:slack_integration.accordion.unfurl_description'),
      allowedChannelsDescription: 'admin:slack_integration.accordion.unfurl_allowed_channels_description',
    },
  };

  return (
    <div className="py-4 px-5">
      <p className="mb-4 fw-bold">{t('admin:slack_integration.accordion.growi_commands')}</p>
      <div className="row d-flex flex-column align-items-center">
        <div className="col-8">
          {Object.values(CommandUsageTypes).map(commandUsageType => (
            <PermissionSettingsForEachCategoryComponent
              key={commandUsageType}
              currentPermissionTypes={currentPermissionTypes}
              usageType={commandUsageType}
              menuItem={menuMap[commandUsageType]}
            />
          ))}
        </div>
      </div>

      <p className="mb-4 fw-bold">Events</p>
      <div className="row d-flex flex-column align-items-center">
        <div className="col-8">
          {Object.values(EventTypes).map(EventType => (
            <PermissionSettingsForEachCategoryComponent
              key={EventType}
              currentPermissionTypes={currentPermissionTypes}
              usageType={EventType}
              menuItem={menuMap[EventType]}
            />
          ))}
        </div>
      </div>

      <div className="row">
        <button
          type="submit"
          className="btn btn-primary mx-auto"
          onClick={updateSettingsHandler}
        >
          { t('Update') }
        </button>
      </div>
    </div>
  );
};

ManageCommandsProcess.propTypes = {
  slackAppIntegrationId: PropTypes.string.isRequired,
  permissionsForBroadcastUseCommands: PropTypes.object.isRequired,
  permissionsForSingleUseCommands: PropTypes.object.isRequired,
  permissionsForSlackEventActions: PropTypes.object.isRequired,
};

export default ManageCommandsProcess;
