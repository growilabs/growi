import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useSWRxKeycloakGroupSyncSettings } from '~/features/external-user-group/client/stores/external-user-group';
import type { KeycloakGroupSyncSettings } from '~/features/external-user-group/interfaces/external-user-group';

export const KeycloakGroupSyncSettingsForm: FC = () => {
  const { t } = useTranslation('admin');

  const { data: keycloakGroupSyncSettings } =
    useSWRxKeycloakGroupSyncSettings();

  const [formValues, setFormValues] = useState<KeycloakGroupSyncSettings>({
    keycloakHost: '',
    keycloakGroupRealm: '',
    keycloakGroupSyncClientRealm: '',
    keycloakGroupSyncClientID: '',
    keycloakGroupSyncClientSecret: '',
    autoGenerateUserOnKeycloakGroupSync: false,
    preserveDeletedKeycloakGroups: false,
    keycloakGroupDescriptionAttribute: '',
  });

  useEffect(() => {
    if (keycloakGroupSyncSettings != null) {
      setFormValues(keycloakGroupSyncSettings);
    }
  }, [keycloakGroupSyncSettings]);

  const submitHandler = useCallback(
    async (e) => {
      e.preventDefault();
      try {
        await apiv3Put(
          '/external-user-groups/keycloak/sync-settings',
          formValues,
        );
        toastSuccess(
          t('external_user_group.keycloak.updated_group_sync_settings'),
        );
      } catch (errs) {
        toastError(t(errs[0]?.message));
      }
    },
    [formValues, t],
  );

  return (
    <>
      <h3 className="border-bottom mb-3">
        {t('external_user_group.keycloak.group_sync_settings')}
      </h3>
      <form onSubmit={submitHandler}>
        <div className="row form-group">
          <label
            htmlFor="keycloakHost"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.keycloak.host')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              type="text"
              name="keycloakHost"
              id="keycloakHost"
              value={formValues.keycloakHost}
              onChange={(e) =>
                setFormValues({ ...formValues, keycloakHost: e.target.value })
              }
            />
            <p className="form-text text-muted">
              <small>{t('external_user_group.keycloak.host_detail')}</small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="keycloakGroupRealm"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.keycloak.group_realm')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              required
              type="text"
              name="keycloakGroupRealm"
              id="keycloakGroupRealm"
              value={formValues.keycloakGroupRealm}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  keycloakGroupRealm: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.keycloak.group_realm_detail')} <br />
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="keycloakGroupSyncClientRealm"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.keycloak.group_sync_client_realm')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              required
              type="text"
              name="keycloakGroupSyncClientRealm"
              id="keycloakGroupSyncClientRealm"
              value={formValues.keycloakGroupSyncClientRealm}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  keycloakGroupSyncClientRealm: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t(
                  'external_user_group.keycloak.group_sync_client_realm_detail',
                )}{' '}
                <br />
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="keycloakGroupSyncClientID"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.keycloak.group_sync_client_id')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              required
              type="text"
              name="keycloakGroupSyncClientID"
              id="keycloakGroupSyncClientID"
              value={formValues.keycloakGroupSyncClientID}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  keycloakGroupSyncClientID: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.keycloak.group_sync_client_id_detail')}{' '}
                <br />
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="keycloakGroupSyncClientSecret"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.keycloak.group_sync_client_secret')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              required
              type="text"
              name="keycloakGroupSyncClientSecret"
              id="keycloakGroupSyncClientSecret"
              value={formValues.keycloakGroupSyncClientSecret}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  keycloakGroupSyncClientSecret: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t(
                  'external_user_group.keycloak.group_sync_client_secret_detail',
                )}{' '}
                <br />
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            <div className="custom-control custom-checkbox custom-checkbox-info">
              <input
                type="checkbox"
                className="custom-control-input me-2"
                name="autoGenerateUserOnKeycloakGroupSync"
                id="autoGenerateUserOnKeycloakGroupSync"
                checked={formValues.autoGenerateUserOnKeycloakGroupSync}
                onChange={() =>
                  setFormValues({
                    ...formValues,
                    autoGenerateUserOnKeycloakGroupSync:
                      !formValues.autoGenerateUserOnKeycloakGroupSync,
                  })
                }
              />
              <label
                className="custom-control-label"
                htmlFor="autoGenerateUserOnKeycloakGroupSync"
              >
                {t('external_user_group.auto_generate_user_on_sync')}
              </label>
            </div>
          </div>
        </div>
        <div className="row form-group">
          <div className="col-md-3"></div>
          <div className="col-md-9">
            <div className="custom-control custom-checkbox custom-checkbox-info">
              <input
                type="checkbox"
                className="custom-control-input me-2"
                name="preserveDeletedKeycloakGroups"
                id="preserveDeletedKeycloakGroups"
                checked={formValues.preserveDeletedKeycloakGroups}
                onChange={() =>
                  setFormValues({
                    ...formValues,
                    preserveDeletedKeycloakGroups:
                      !formValues.preserveDeletedKeycloakGroups,
                  })
                }
              />
              <label
                className="custom-control-label"
                htmlFor="preserveDeletedKeycloakGroups"
              >
                {t(
                  'external_user_group.keycloak.preserve_deleted_keycloak_groups',
                )}
              </label>
            </div>
          </div>
        </div>
        <div className="mt-5 mb-4">
          <h4 className="border-bottom mb-3">
            Attribute Mapping ({t('optional')})
          </h4>
        </div>
        <div className="row form-group">
          <label
            htmlFor="keycloakGroupDescriptionAttribute"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('Description')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              type="text"
              name="keycloakGroupDescriptionAttribute"
              id="keycloakGroupDescriptionAttribute"
              value={formValues.keycloakGroupDescriptionAttribute || ''}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  keycloakGroupDescriptionAttribute: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.description_mapper_detail')}
              </small>
            </p>
          </div>
        </div>

        <div className="row my-3">
          <div className="offset-3 col-5">
            <button type="submit" className="btn btn-primary">
              {t('Update')}
            </button>
          </div>
        </div>
      </form>
    </>
  );
};
