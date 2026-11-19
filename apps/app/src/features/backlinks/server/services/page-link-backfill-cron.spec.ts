import { mock } from 'vitest-mock-extended';

import { SocketEventName } from '~/interfaces/websocket';
import type { SocketIoService } from '~/server/service/socket-io';

import type { BacklinksBackfillProgressData } from '../../interfaces/page-link-backfill';
import { createAdminProgressEmitter } from './page-link-backfill-cron';

const PROGRESS: BacklinksBackfillProgressData = {
  status: 'running',
  processed: 3,
  runTotal: 10,
  skippedPages: 0,
};

describe('createAdminProgressEmitter', () => {
  it('sends the progress on the admin channel', () => {
    const adminSocket = mock<ReturnType<SocketIoService['getAdminSocket']>>();
    const socketIoService = mock<SocketIoService>();
    socketIoService.getAdminSocket.mockReturnValue(adminSocket);

    createAdminProgressEmitter(socketIoService)(PROGRESS);

    expect(adminSocket.emit).toHaveBeenCalledWith(
      SocketEventName.BacklinksBackfillProgress,
      PROGRESS,
    );
  });

  // The backfill runs off the request path; a missing progress line must not fail the run.
  it('drops the progress instead of throwing before the HTTP server is attached', () => {
    const socketIoService = mock<SocketIoService>();
    socketIoService.getAdminSocket.mockImplementation(() => {
      throw new Error('Http server has not attached yet.');
    });

    expect(() =>
      createAdminProgressEmitter(socketIoService)(PROGRESS),
    ).not.toThrow();
  });
});
