import { useTranslation } from 'next-i18next';
import React, { type JSX, useCallback } from 'react';

import { apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

import type { IGrowiPluginOrigin } from '../../../../interfaces';
import { useSWRxAdminPlugins } from '../../../stores/admin-plugins';

export const PluginInstallerForm = (): JSX.Element => {
  const { mutate } = useSWRxAdminPlugins();
  const { t } = useTranslation('admin');

  const submitHandler = useCallback(
    async (e) => {
      e.preventDefault();

      const formData = e.target.elements;

      const {
        'pluginInstallerForm[url]': { value: url },
        'pluginInstallerForm[ghBranch]': { value: ghBranch },
        // 'pluginInstallerForm[ghTag]': { value: ghTag },
      } = formData;

      const pluginInstallerForm: IGrowiPluginOrigin = {
        url,
        ghBranch: ghBranch || 'main',
        // ghTag,
      };

      try {
        const res = await apiv3Post('/plugins', { pluginInstallerForm });
        const pluginName = res.data.pluginName;
        toastSuccess(t('toaster.install_plugin_success', { pluginName }));
      } catch (e) {
        toastError(e);
      } finally {
        mutate();
      }
    },
    [mutate, t],
  );

  return (
    <form onSubmit={submitHandler}>
      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="repoUrl"
        >
          {t('plugins.form.label_url')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control"
            type="text"
            name="pluginInstallerForm[url]"
            placeholder="https://github.com/growilabs/growi-plugins-example"
            required
            id="repoUrl"
          />
          <p className="form-text text-muted">{t('plugins.form.desc_url')}</p>
        </div>
      </div>
      <div className="row">
        <label
          className="text-start text-md-end col-md-3 col-form-label"
          htmlFor="branchName"
        >
          {t('plugins.form.label_branch')}
        </label>
        <div className="col-md-6">
          <input
            className="form-control col-md-3"
            type="text"
            name="pluginInstallerForm[ghBranch]"
            placeholder="main"
            id="branchName"
          />
          <p className="form-text text-muted">
            {t('plugins.form.desc_branch')}
          </p>
        </div>
      </div>

      <div className="row my-3">
        <div className="mx-auto">
          <button type="submit" className="btn btn-primary">
            {t('plugins.install')}
          </button>
        </div>
      </div>
    </form>
  );
};
