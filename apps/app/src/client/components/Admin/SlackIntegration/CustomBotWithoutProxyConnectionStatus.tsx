import React, { type JSX } from 'react';

import type { ConnectionStatus } from '@growi/slack';
import Image from 'next/image';

import { Bridge } from './Bridge';

type CustomBotWithoutProxyConnectionStatusProps = {
  siteName: string,
  connectionStatuses: any,
}

export const CustomBotWithoutProxyConnectionStatus = (props: CustomBotWithoutProxyConnectionStatusProps): JSX.Element => {
  const { siteName, connectionStatuses } = props;

  const connectionStatusValues: ConnectionStatus[] = Object.values(connectionStatuses);

  const totalCount = connectionStatusValues.length;
  const errorCount = connectionStatusValues.filter(connectionStatus => connectionStatus.error != null).length;
  const workspaceName = connectionStatusValues[0]?.workspaceName;

  return (
    <div className="row justify-content-center my-5 bot-integration">
      <div className="card rounded shadow col-4 border-0 admin-bot-card mb-0">
        <h5 className="card-title fw-bold mt-3 text-center">Slack</h5>
        <div className="card-body px-4 text-center mx-md-5">
          {totalCount > 0 ? (
            <div className="card slack-work-space-name-card">
              <div className="m-2 text-center">
                <h5 className="fw-bold">
                  {workspaceName != null ? workspaceName : 'Settings #1'}
                </h5>
                <Image width={20} height={20} src="/images/slack-integration/growi-bot-kun-icon.png" alt="" />
              </div>
            </div>
          ) : ''}
        </div>
      </div>

      <div className="col-3 text-center">
        <Bridge errorCount={errorCount} totalCount={totalCount} />
      </div>

      <div className="card rounded-3 shadow col-4 border-0 admin-bot-card mb-0">
        <h5 className="card-title fw-bold mt-3 text-center">GROWI App</h5>
        <div className="card-body p-4 text-center">
          <div className="border p-2 bg-primary text-light mx-md-5">
            {siteName}
          </div>
        </div>
      </div>

    </div>
  );
};

CustomBotWithoutProxyConnectionStatus.displayName = 'CustomBotWithoutProxyConnectionStatus';
