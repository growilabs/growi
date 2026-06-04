import type { Request, Response } from 'express';

import { denyUploadsDirectAccess } from './deny-uploads-direct-access';

describe('denyUploadsDirectAccess', () => {
  test('responds with 403 Forbidden', () => {
    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const req = {
      originalUrl: '/uploads/attachment/evil.html',
    } as unknown as Request;
    const res = { status } as unknown as Response;

    denyUploadsDirectAccess(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(send).toHaveBeenCalledWith('Forbidden');
  });
});
