import React, { type JSX, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import styles from './PluginCard.module.scss';

type Props = {
  id: string;
  name: string;
  url: string;
  isEnabled: boolean;
  desc?: string;
  onDelete: () => void;
};

export const PluginCard = (props: Props): JSX.Element => {
  const { id, name, url, isEnabled, desc } = props;

  const { t } = useTranslation('admin');

  const PluginCardButton = (): JSX.Element => {
    const [_isEnabled, setIsEnabled] = useState<boolean>(isEnabled);

    const onChangeHandler = async () => {
      try {
        if (_isEnabled) {
          const reqUrl = `/plugins/${id}/deactivate`;
          const res = await apiv3Put(reqUrl);
          setIsEnabled(!_isEnabled);
          const pluginName = res.data.pluginName;
          toastSuccess(t('toaster.deactivate_plugin_success', { pluginName }));
        } else {
          const reqUrl = `/plugins/${id}/activate`;
          const res = await apiv3Put(reqUrl);
          setIsEnabled(!_isEnabled);
          const pluginName = res.data.pluginName;
          toastSuccess(t('toaster.activate_plugin_success', { pluginName }));
        }
      } catch (err) {
        toastError(err);
      }
    };

    return (
      <div className={`${styles.plugin_card}`}>
        <div className="switch">
          <label className="form-label switch__label">
            <input
              type="checkbox"
              className="switch__input"
              onChange={() => onChangeHandler()}
              checked={isEnabled}
            />
            <span className="switch__content"></span>
            <span className="switch__circle"></span>
          </label>
        </div>
      </div>
    );
  };

  const PluginDeleteButton = (): JSX.Element => {
    return (
      <div>
        <button
          type="submit"
          className="btn btn-primary"
          onClick={props.onDelete}
        >
          {t('Delete')}
        </button>
      </div>
    );
  };

  return (
    <div className="card shadow border-0" key={name}>
      <div className="card-body px-5 py-4 mt-3">
        <div className="row mb-3">
          <div className="col-9">
            <h2 className="card-title h3 border-bottom pb-2 mb-3">
              <Link href={`${url}`} legacyBehavior>
                {name}
              </Link>
            </h2>
            <p className="card-text text-muted">{desc}</p>
          </div>
          <div className="col-3">
            <div>
              <PluginCardButton />
            </div>
            <div className="mt-4">
              <PluginDeleteButton />
            </div>
          </div>
        </div>
      </div>
      <div className="card-footer px-5 border-top-0">
        <p className="d-flex justify-content-between align-self-center mb-0"></p>
      </div>
    </div>
  );
};
