import React, { useMemo, useState } from 'react';

import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { TabContent, TabPane } from 'reactstrap';

import CustomNav from '../../CustomNavigation/CustomNav';

import GitHubSecuritySetting from './GitHubSecuritySetting';
import GoogleSecuritySetting from './GoogleSecuritySetting';
import LdapSecuritySetting from './LdapSecuritySetting';
import LocalSecuritySetting from './LocalSecuritySetting';
import OidcSecuritySetting from './OidcSecuritySetting';
import SamlSecuritySetting from './SamlSecuritySetting';
import { SecuritySetting } from './SecuritySetting';
import ShareLinkSetting from './ShareLinkSetting';

const SecurityManagementContents = () => {
  const { t } = useTranslation('admin');

  const [activeTab, setActiveTab] = useState('passport_local');
  const [activeComponents, setActiveComponents] = useState(new Set(['passport_local']));

  const switchActiveTab = (selectedTab) => {
    setActiveTab(selectedTab);
    setActiveComponents(activeComponents.add(selectedTab));
  };

  const navTabMapping = useMemo(() => {
    return {
      passport_local: {
        Icon: () => <span className="material-symbols-outlined">groups</span>,
        i18n: 'ID/Pass',
      },
      passport_ldap: {
        Icon: () => <span className="material-symbols-outlined">network_node</span>,
        i18n: 'LDAP',
      },
      passport_saml: {
        Icon: () => <span className="material-symbols-outlined">key</span>,
        i18n: 'SAML',
      },
      passport_oidc: {
        Icon: () => <span className="material-symbols-outlined">key</span>,
        i18n: 'OIDC',
      },
      passport_google: {
        Icon: () => <span className="growi-custom-icons align-bottom">google</span>,
        i18n: 'Google',
      },
      passport_github: {
        Icon: () => <span className="growi-custom-icons align-bottom">github</span>,
        i18n: 'GitHub',
      },
    };
  }, []);


  return (
    <div data-testid="admin-security">
      <div className="mb-5">
        <SecuritySetting />
      </div>

      {/* Shared Link List */}
      <div className="mb-5">
        <ShareLinkSetting />
      </div>


      {/* XSS configuration link */}
      <div className="mb-5">
        <h2 className="border-bottom pb-2">{t('security_settings.xss_prevent_setting')}</h2>
        <div className="mt-4">
          <Link
            href="/admin/markdown/#preventXSS"
            style={{ fontSize: 'large' }}
          >
            <span className="material-symbols-outlined me-1">login</span> {t('security_settings.xss_prevent_setting_link')}
          </Link>
        </div>
      </div>

      <div className="auth-mechanism-configurations">
        <h2 className="border-bottom pb-2">{t('security_settings.Authentication mechanism settings')}</h2>
        <CustomNav
          activeTab={activeTab}
          navTabMapping={navTabMapping}
          onNavSelected={switchActiveTab}
          hideBorderBottom
          breakpointToSwitchDropdownDown="md"
        />
        <TabContent activeTab={activeTab} className="p-5">
          <TabPane tabId="passport_local">
            {activeComponents.has('passport_local') && <LocalSecuritySetting />}
          </TabPane>
          <TabPane tabId="passport_ldap">
            {activeComponents.has('passport_ldap') && <LdapSecuritySetting />}
          </TabPane>
          <TabPane tabId="passport_saml">
            {activeComponents.has('passport_saml') && <SamlSecuritySetting />}
          </TabPane>
          <TabPane tabId="passport_oidc">
            {activeComponents.has('passport_oidc') && <OidcSecuritySetting />}
          </TabPane>
          <TabPane tabId="passport_google">
            {activeComponents.has('passport_google') && <GoogleSecuritySetting />}
          </TabPane>
          <TabPane tabId="passport_github">
            {activeComponents.has('passport_github') && <GitHubSecuritySetting />}
          </TabPane>
        </TabContent>
      </div>
    </div>
  );

};

export default SecurityManagementContents;
