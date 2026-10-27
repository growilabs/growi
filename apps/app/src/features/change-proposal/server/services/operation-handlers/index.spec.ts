import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { createOperationHandlers, getOperationHandler } from '.';

describe('operation handler table', () => {
  const table = createOperationHandlers(mock<Crowi>());

  it.each(['edit', 'create'] as const)('has a handler for %s', (type) => {
    const handler = getOperationHandler(table, type);
    expect(handler.findExistingResult).toBeTypeOf('function');
    expect(handler.execute).toBeTypeOf('function');
    expect(handler.sendPerPageNotifications).toBeTypeOf('function');
  });

  it('throws for an operation type that has no handler registered', () => {
    expect(() => getOperationHandler({}, 'edit')).toThrow(/edit/);
  });
});
