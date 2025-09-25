
import type { JSX } from 'react';

import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';


const ProxyCircle = () => (
  <div className="grw-bridge-proxy-circle position-relative">
    <div className="circle position-absolute m-auto z-1 bg-primary border-light rounded-circle">
      <p className="circle-inner position-absolute text-light fw-bold d-none d-lg-inline">Proxy Server</p>
      <p className="circle-inner position-absolute grw-proxy-server-name d-inline d-lg-none">Proxy Server</p>
    </div>
  </div>
);

type BridgeCoreProps = {
  description: string,
  iconClass: string,
  iconName: string,
  hrClass: string,
  withProxy?: boolean,
}
const BridgeCore = (props: BridgeCoreProps): JSX.Element => {
  const {
    description, iconClass, iconName, hrClass, withProxy,
  } = props;

  return (
    <>
      <div id="grw-bridge-container" className={`grw-bridge-container ${withProxy ? 'with-proxy' : ''}`}>
        <p className={`${withProxy ? 'mt-0' : 'mt-2'}`}>
          <span className={iconClass}>{iconName}</span>
          <small
            className="ms-2 d-none d-lg-inline"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: description }}
          />
        </p>
        <div className="hr-container">
          { withProxy && <ProxyCircle /> }
          <hr className={`align-self-center ${hrClass}`} />
        </div>
      </div>
      <UncontrolledTooltip placement="top" fade={false} target="grw-bridge-container" className="d-block d-lg-none">
        <small
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: description }}
        />
      </UncontrolledTooltip>
    </>
  );
};


type BridgeProps = {
  errorCount: number,
  totalCount: number,
  withProxy?: boolean,
}
export const Bridge = (props: BridgeProps): JSX.Element => {
  const { t } = useTranslation();
  const { errorCount, totalCount, withProxy } = props;

  let description;
  let iconClass;
  let iconName;
  let hrClass;

  // empty or all failed
  if (totalCount === 0 || errorCount === totalCount) {
    description = t('admin:slack_integration.integration_sentence.integration_is_not_complete');
    iconClass = 'material-symbols-outlined text-danger';
    iconName = 'info';
    hrClass = 'border-danger admin-border-failed';
  }
  // all green
  else if (errorCount === 0) {
    description = t('admin:slack_integration.integration_sentence.integration_successful');
    iconClass = 'material-symbols-outlined text-success';
    iconName = 'check';
    hrClass = 'border-success admin-border-success';
  }
  // some of them failed
  else {
    description = t('admin:slack_integration.integration_sentence.integration_some_ws_is_not_complete');
    iconClass = 'material-symbols-outlined text-warning';
    iconName = 'check';
    hrClass = 'border-warning admin-border-failed';
  }

  return (
    <BridgeCore
      description={description}
      iconClass={iconClass}
      iconName={iconName}
      hrClass={hrClass}
      withProxy={withProxy}
    />
  );
};

Bridge.displayName = 'Bridge';
