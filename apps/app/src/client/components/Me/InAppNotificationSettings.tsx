import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';

import { apiv3Get, apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import {
  SubscribeRuleDescriptions,
  subscribeRuleNames,
} from '~/interfaces/in-app-notification';

type SubscribeRule = {
  name: string;
  isEnabled: boolean;
};

const subscribeRulesMenuItems = [
  {
    name: subscribeRuleNames.PAGE_CREATE,
    description: SubscribeRuleDescriptions.PAGE_CREATE,
  },
];

const isCheckedRule = (ruleName: string, subscribeRules: SubscribeRule[]) =>
  subscribeRules.find((stateRule) => stateRule.name === ruleName)?.isEnabled ||
  false;

const updateIsEnabled = (
  subscribeRules: SubscribeRule[],
  ruleName: string,
  isChecked: boolean,
) => {
  const target = [{ name: ruleName, isEnabled: isChecked }];
  return subscribeRules.filter((rule) => rule.name !== ruleName).concat(target);
};

const InAppNotificationSettings: FC = () => {
  const { t } = useTranslation();
  const [subscribeRules, setSubscribeRules] = useState<SubscribeRule[]>([]);

  const initializeInAppNotificationSettings = useCallback(async () => {
    const { data } = await apiv3Get(
      '/personal-setting/in-app-notification-settings',
    );
    const retrievedRules: SubscribeRule[] | null = data?.subscribeRules;

    if (retrievedRules != null && retrievedRules.length > 0) {
      setSubscribeRules(retrievedRules);
    }
  }, []);

  const ruleCheckboxHandler = useCallback(
    (ruleName: string, isChecked: boolean) => {
      setSubscribeRules((prevState) =>
        updateIsEnabled(prevState, ruleName, isChecked),
      );
    },
    [],
  );

  const updateSettingsHandler = useCallback(async () => {
    try {
      const { data } = await apiv3Put(
        '/personal-setting/in-app-notification-settings',
        { subscribeRules },
      );
      setSubscribeRules(data.subscribeRules);
      toastSuccess(
        t('toaster.update_successed', {
          target: 'InAppNotification Settings',
          ns: 'commons',
        }),
      );
    } catch (err) {
      toastError(err);
    }
  }, [subscribeRules, setSubscribeRules, t]);

  useEffect(() => {
    initializeInAppNotificationSettings();
  }, [initializeInAppNotificationSettings]);

  return (
    <>
      <h2 className="border-bottom pb-2 my-4 fs-4">
        {t('in_app_notification_settings.subscribe_settings')}
      </h2>

      <div className="row">
        <div className="offset-md-3 col-md-6 text-start">
          {subscribeRulesMenuItems.map((rule) => (
            <div
              key={rule.name}
              className="form-check form-switch form-check-success"
            >
              <input
                type="checkbox"
                className="form-check-input"
                id={rule.name}
                checked={isCheckedRule(rule.name, subscribeRules)}
                onChange={(e) =>
                  ruleCheckboxHandler(rule.name, e.target.checked)
                }
              />
              <label
                className="form-label form-check-label"
                htmlFor={rule.name}
              >
                <strong>{rule.name}</strong>
              </label>
              <p className="form-text text-muted small">
                {t(rule.description)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="row my-3">
        <div className="offset-4 col-5">
          <button
            data-testid="grw-in-app-notification-settings-update-button"
            type="button"
            className="btn btn-primary"
            onClick={updateSettingsHandler}
          >
            {t('Update')}
          </button>
        </div>
      </div>
    </>
  );
};

export default InAppNotificationSettings;
