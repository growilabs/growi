import type Crowi from '~/server/crowi';

import type { OperationType } from '../../../interfaces';
import { createCreateHandler } from './create';
import { createDeleteCompletelyHandler } from './delete-completely';
import { createEditHandler } from './edit';
import { createMoveHandler } from './move';
import type { OperationHandlerTable } from './types';

export type {
  AppliedOutcome,
  ExistingResultContext,
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
  move: createMoveHandler(crowi),
  'delete-completely': createDeleteCompletelyHandler(crowi),
});

export const getOperationHandler = <K extends OperationType>(
  table: OperationHandlerTable,
  type: K,
): OperationHandlerTable[K] => table[type];
