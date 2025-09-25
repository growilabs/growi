import React, { type JSX } from 'react';

import type { ConnectionStatus } from '@growi/slack';
import Image from 'next/image';

import { Bridge } from './Bridge';


type CustomBotWithProxyConnectionStatusProps = {
  siteName: string,
  connectionStatuses: any,
}

export const CustomBotWithProxyConnectionStatus = (props: CustomBotWithProxyConnectionStatusProps): JSX.Element => {
  const { siteName, connectionStatuses } = props;

  const connectionStatusValues: ConnectionStatus[] = Object.values(connectionStatuses);

  const totalCount = connectionStatusValues.length;
  const errorCount = connectionStatusValues.filter(connectionStatus => connectionStatus.error != null).length;

  return (
    <div className="row justify-content-center my-5 bot-integration">

      <div className="card rounded shadow col-4 border-0 admin-bot-card">
        <h5 className="card-title fw-bold mt-3 text-center">Slack</h5>
        <div className="card-body px-5">
          {connectionStatusValues.map((connectionStatus, i) => {
            const workspaceName = connectionStatus.workspaceName || `Settings #${i}`;

            return (
              <div key={workspaceName} className="card slack-work-space-name-card">
                <div className="m-2 text-center">
                  <h5 className="fw-bold">{workspaceName}</h5>
                  <Image width={20} height={20} src="/images/slack-integration/growi-bot-kun-icon.png" alt="" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="col-3 mt-3 text-center">
        <Bridge errorCount={errorCount} totalCount={totalCount} withProxy />
      </div>

      <div className="card rounded-3 shadow col-4 border-0 admin-bot-card">
        <h5 className="card-title fw-bold mt-3 text-center">GROWI App</h5>
        <div className="card-body text-center">
          <div className="mx-md-3 my-4 my-lg-5 p-2 border bg-primary text-light">
            {siteName}
          </div>
        </div>
      </div>
    </div>
  );
};

CustomBotWithProxyConnectionStatus.displayName = 'CustomBotWithProxyConnectionStatus';
