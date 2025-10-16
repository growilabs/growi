import React, { type JSX } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import { Spinner } from 'reactstrap';

import {
  usePluginDeleteModal,
  useSWRxAdminPlugins,
} from '../../../stores/admin-plugins';
import { PluginCard } from './PluginCard';
import { PluginInstallerForm } from './PluginInstallerForm';

const Loading = (): JSX.Element => {
  return (
    <Spinner className="d-flex justify-content-center aligh-items-center">
      Loading...
    </Spinner>
  );
};

export const PluginsExtensionPageContents = (): JSX.Element => {
  const { t } = useTranslation('admin');
  const PluginDeleteModal = dynamic(
    () => import('./PluginDeleteModal').then((mod) => mod.PluginDeleteModal),
    { ssr: false },
  );
  const { data, mutate } = useSWRxAdminPlugins();
  const { open: openPluginDeleteModal } = usePluginDeleteModal();

  return (
    <div>
      <div className="row mb-5">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">
            {t('plugins.plugin_installer')}
          </h2>
          <PluginInstallerForm />
        </div>
      </div>

      <div className="row mb-5">
        <div className="col-lg-12">
          <h2 className="admin-setting-header">
            {t('plugins.plugin_card')}
            <button
              type="button"
              className="btn btn-sm ms-auto grw-btn-reload"
              onClick={() => mutate()}
            >
              <span className="material-symbols-outlined">refresh</span>
            </button>
          </h2>
          {data?.plugins == null ? (
            <Loading />
          ) : (
            <div className="d-grid gap-5">
              {data.plugins.length === 0 && (
                <div>{t('plugins.plugin_is_not_installed')}</div>
              )}
              {data.plugins.map((plugin) => (
                <PluginCard
                  key={plugin._id}
                  id={plugin._id}
                  name={plugin.meta.name}
                  url={plugin.origin.url}
                  isEnabled={plugin.isEnabled}
                  desc={plugin.meta.desc}
                  onDelete={() => openPluginDeleteModal(plugin)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <PluginDeleteModal />
    </div>
  );
};
