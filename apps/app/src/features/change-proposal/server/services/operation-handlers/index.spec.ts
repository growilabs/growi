import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { createOperationHandlers, getOperationHandler } from '.';

describe('operation handler table', () => {
  const table = createOperationHandlers(mock<Crowi>());

  it.each([
    'edit',
    'create',
    'move',
    'delete-completely',
  ] as const)('has a handler for %s', (type) => {
    const handler = getOperationHandler(table, type);
    expect(handler.findExistingResult).toBeTypeOf('function');
    expect(handler.execute).toBeTypeOf('function');
    expect(handler.sendPerPageNotifications).toBeTypeOf('function');
  });
});
