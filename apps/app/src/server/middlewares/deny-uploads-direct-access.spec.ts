import type { Request, Response } from 'express';
import { mock } from 'vitest-mock-extended';

import { denyUploadsDirectAccess } from './deny-uploads-direct-access.js';

describe('denyUploadsDirectAccess', () => {
  test('responds with 403 Forbidden', () => {
    const req = mock<Request>();
    req.originalUrl = '/uploads/attachment/evil.html';

    const res = mock<Response>();
    // res.status(...) returns `this` (Response) in Express, enabling the
    // status().send() chain. Mirror that so the chained send() can be asserted.
    res.status.mockReturnValue(res);

    denyUploadsDirectAccess(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Forbidden');
  });
});
