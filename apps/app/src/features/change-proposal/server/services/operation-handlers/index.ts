import type Crowi from '~/server/crowi';

import type { OperationType } from '../../../interfaces';
import { createCreateHandler } from './create';
import { createEditHandler } from './edit';
import { createMoveHandler } from './move';
import { createRestoreHandler } from './restore';
import { createTrashHandler } from './trash';
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
  move: createMoveHandler(crowi),
  trash: createTrashHandler(crowi),
  restore: createRestoreHandler(crowi),
});

export const getOperationHandler = <K extends OperationType>(
  table: OperationHandlerTable,
  type: K,
): OperationHandlerTable[K] => table[type];
