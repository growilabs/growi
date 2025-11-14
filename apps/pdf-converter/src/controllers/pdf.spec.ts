import { PlatformTest } from '@tsed/platform-http/testing';
import { JobStatus, JobStatusSharedWithGrowi } from 'src/service/pdf-convert';
import SuperTest from 'supertest';

import Server from '../server';

describe('PdfCtrl', () => {
  beforeAll(PlatformTest.bootstrap(Server));
  afterAll(PlatformTest.reset);

  it('should return 500 for invalid appId', async () => {
    const request = SuperTest(PlatformTest.callback());
    await request
      .post('/pdf/sync-job')
      .send({
        jobId: '64d2fa8b2f9c1e4a9b5e3d77',
        expirationDate: '2024-01-01T00:00:00Z',
        status: JobStatusSharedWithGrowi.HTML_EXPORT_IN_PROGRESS,
        appId: '../../../admin/secret-dir',
      })
      .expect(500);
  });

  it('should return 400 for invalid jobId', async () => {
    const request = SuperTest(PlatformTest.callback());
    const res = await request
      .post('/pdf/sync-job')
      .send({
        jobId: '../../../admin/secret-dir',
        expirationDate: '2024-01-01T00:00:00Z',
        status: JobStatusSharedWithGrowi.HTML_EXPORT_IN_PROGRESS,
        appId: 1,
      })
      .expect(400);

    expect(res.body.message).toContain(
      'jobId must be a valid MongoDB ObjectId',
    );
  });

  it('should return 202 and status for valid request', async () => {
    const request = SuperTest(PlatformTest.callback());
    const res = await request
      .post('/pdf/sync-job')
      .send({
        jobId: '64d2fa8b2f9c1e4a9b5e3d77',
        expirationDate: '2024-01-01T00:00:00Z',
        status: JobStatusSharedWithGrowi.HTML_EXPORT_IN_PROGRESS,
        appId: 1,
      })
      .expect(202);

    expect(res.body).toHaveProperty('status');
    expect(Object.values(JobStatus)).toContain(res.body.status);
  });
});
