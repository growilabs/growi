import type { FC } from 'react';
import React, { useState } from 'react';

import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Collapse } from 'reactstrap';

import { AllSupportedActions } from '~/interfaces/activity';
import { activityExpirationSecondsAtom, auditLogAvailableActionsAtom } from '~/states/server-configurations';

export const AuditLogSettings: FC = () => {
  const { t } = useTranslation();

  const [isExpandActionList, setIsExpandActionList] = useState(false);

  const activityExpirationSeconds = useAtomValue(activityExpirationSecondsAtom) || 2592000;

  const availableActions = useAtomValue(auditLogAvailableActionsAtom);

  return (
    <>
      <h4 className="mt-4">{t('admin:audit_log_management.activity_expiration_date')}</h4>
      <p className="form-text text-muted">
        {t('admin:audit_log_management.activity_expiration_date_explanation')}
      </p>
      <p className="alert alert-warning col-6">
        <span className="material-symbols-outlined">error</span>
        <b>FIXED</b><br />
        <b
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: t('admin:audit_log_management.fixed_by_env_var',
              { key: 'ACTIVITY_EXPIRATION_SECONDS', value: activityExpirationSeconds }),
          }}
        />
      </p>

      <h4 className="mt-4">
        {t('admin:audit_log_management.available_action_list')}
        <span className="badge rounded-pill bg-primary ms-2">
          {`${availableActions.length} / ${AllSupportedActions.length}`}
        </span>
        <a
          className="ms-2"
          href={t('admin:audit_log_management.docs_url.log_type')}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="material-symbols-outlined" aria-hidden="true">help</span>
        </a>
      </h4>
      <p className="form-text text-muted">
        {t('admin:audit_log_management.available_action_list_explanation')}
      </p>
      <p className="mt-1">
        <button type="button" className="btn btn-link p-0" aria-expanded="false" onClick={() => setIsExpandActionList(!isExpandActionList)}>
          <span className={`material-symbols-outlined me-1 ${isExpandActionList ? 'rotate-90' : ''}`}>navigate_next</span>
          { t('admin:audit_log_management.action_list') }
        </button>
      </p>
      <Collapse isOpen={isExpandActionList}>
        <ul className="list-group">
          { availableActions.map(action => (
            <li key={action} className="list-group-item">{t(`admin:audit_log_action.${action}`)}</li>
          )) }
        </ul>
      </Collapse>
    </>
  );
};
