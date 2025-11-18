import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useSWRxLdapGroupSyncSettings } from '~/features/external-user-group/client/stores/external-user-group';
import type { LdapGroupSyncSettings } from '~/features/external-user-group/interfaces/external-user-group';
import { LdapGroupMembershipAttributeType } from '~/features/external-user-group/interfaces/external-user-group';

export const LdapGroupSyncSettingsForm: FC = () => {
  const { t } = useTranslation('admin');

  const { data: ldapGroupSyncSettings } = useSWRxLdapGroupSyncSettings();

  const [formValues, setFormValues] = useState<LdapGroupSyncSettings>({
    ldapGroupSearchBase: '',
    ldapGroupMembershipAttribute: '',
    ldapGroupMembershipAttributeType: LdapGroupMembershipAttributeType.dn,
    ldapGroupChildGroupAttribute: '',
    autoGenerateUserOnLdapGroupSync: false,
    preserveDeletedLdapGroups: false,
    ldapGroupNameAttribute: '',
    ldapGroupDescriptionAttribute: '',
  });

  useEffect(() => {
    if (ldapGroupSyncSettings != null) {
      setFormValues(ldapGroupSyncSettings);
    }
  }, [ldapGroupSyncSettings]);

  const submitHandler = useCallback(
    async (e) => {
      e.preventDefault();
      try {
        await apiv3Put('/external-user-groups/ldap/sync-settings', formValues);
        toastSuccess(t('external_user_group.ldap.updated_group_sync_settings'));
      } catch (errs) {
        toastError(t(errs[0]?.code));
      }
    },
    [formValues, t],
  );

  return (
    <>
      <h3 className="border-bottom mb-3">
        {t('external_user_group.ldap.group_sync_settings')}
      </h3>
      <form onSubmit={submitHandler}>
        <div className="row form-group">
          <label
            htmlFor="ldapGroupSearchBase"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.ldap.group_search_base_DN')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              type="text"
              name="ldapGroupSearchBase"
              id="ldapGroupSearchBase"
              value={formValues.ldapGroupSearchBase}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  ldapGroupSearchBase: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.ldap.group_search_base_dn_detail')}
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="ldapGroupMembershipAttribute"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.ldap.membership_attribute')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              required
              type="text"
              name="ldapGroupMembershipAttribute"
              id="ldapGroupMembershipAttribute"
              value={formValues.ldapGroupMembershipAttribute}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  ldapGroupMembershipAttribute: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.ldap.membership_attribute_detail')}{' '}
                <br />
                e.g.) <code>member</code>, <code>memberUid</code>
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="ldapGroupMembershipAttributeType"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.ldap.membership_attribute_type')}
          </label>
          <div className="col-md-9">
            <select
              className="form-control"
              required
              name="ldapGroupMembershipAttributeType"
              id="ldapGroupMembershipAttributeType"
              value={formValues.ldapGroupMembershipAttributeType}
              onChange={(e) => {
                if (
                  e.target.value === LdapGroupMembershipAttributeType.dn ||
                  e.target.value === LdapGroupMembershipAttributeType.uid
                ) {
                  setFormValues({
                    ...formValues,
                    ldapGroupMembershipAttributeType: e.target.value,
                  });
                }
              }}
            >
              <option value="DN">DN</option>
              <option value="UID">UID</option>
            </select>
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.ldap.membership_attribute_type_detail')}
              </small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="ldapGroupChildGroupAttribute"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('external_user_group.ldap.child_group_attribute')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              required
              type="text"
              name="ldapGroupChildGroupAttribute"
              id="ldapGroupChildGroupAttribute"
              value={formValues.ldapGroupChildGroupAttribute}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  ldapGroupChildGroupAttribute: e.target.value,
                })
              }
            />
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.ldap.child_group_attribute_detail')}
                <br />
                e.g.) <code>member</code>
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
                name="autoGenerateUserOnLdapGroupSync"
                id="autoGenerateUserOnLdapGroupSync"
                checked={formValues.autoGenerateUserOnLdapGroupSync}
                onChange={() =>
                  setFormValues({
                    ...formValues,
                    autoGenerateUserOnLdapGroupSync:
                      !formValues.autoGenerateUserOnLdapGroupSync,
                  })
                }
              />
              <label
                className="custom-control-label"
                htmlFor="autoGenerateUserOnLdapGroupSync"
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
                name="preserveDeletedLdapGroups"
                id="preserveDeletedLdapGroups"
                checked={formValues.preserveDeletedLdapGroups}
                onChange={() =>
                  setFormValues({
                    ...formValues,
                    preserveDeletedLdapGroups:
                      !formValues.preserveDeletedLdapGroups,
                  })
                }
              />
              <label
                className="custom-control-label"
                htmlFor="preserveDeletedLdapGroups"
              >
                {t('external_user_group.ldap.preserve_deleted_ldap_groups')}
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
            htmlFor="ldapGroupNameAttribute"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('Name')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              type="text"
              name="ldapGroupNameAttribute"
              id="ldapGroupNameAttribute"
              value={formValues.ldapGroupNameAttribute}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  ldapGroupNameAttribute: e.target.value,
                })
              }
              placeholder="Default: cn"
            />
            <p className="form-text text-muted">
              <small>{t('external_user_group.ldap.name_mapper_detail')}</small>
            </p>
          </div>
        </div>
        <div className="row form-group">
          <label
            htmlFor="ldapGroupDescriptionAttribute"
            className="text-left text-md-end col-md-3 col-form-label"
          >
            {t('Description')}
          </label>
          <div className="col-md-9">
            <input
              className="form-control"
              type="text"
              name="ldapGroupDescriptionAttribute"
              id="ldapGroupDescriptionAttribute"
              value={formValues.ldapGroupDescriptionAttribute || ''}
              onChange={(e) =>
                setFormValues({
                  ...formValues,
                  ldapGroupDescriptionAttribute: e.target.value,
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
