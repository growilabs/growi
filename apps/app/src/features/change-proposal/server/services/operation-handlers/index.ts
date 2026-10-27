import type Crowi from '~/server/crowi';

import type { OperationType } from '../../../interfaces';
import { createCreateHandler } from './create';
import { createEditHandler } from './edit';
import type { OperationHandlerTable } from './types';

export type {
  AppliedOutcome,
  OperationContext,
  OperationHandler,
  OperationHandlerTable,
  OperationOutcome,
  OperationRecordOf,
} from './types';

export const createOperationHandlers = (
  crowi: Crowi,
): OperationHandlerTable => ({
  edit: createEditHandler(crowi),
  create: createCreateHandler(crowi),
});

export const getOperationHandler = <K extends OperationType>(
  table: OperationHandlerTable,
  type: K,
): NonNullable<OperationHandlerTable[K]> => {
  const handler = table[type];
  if (handler == null) {
    throw new Error(`No operation handler is registered for '${type}'`);
  }
  return handler;
};
