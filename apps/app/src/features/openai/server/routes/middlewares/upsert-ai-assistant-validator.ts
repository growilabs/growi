import { GroupType } from '@growi/core';
import { body, type ValidationChain } from 'express-validator';
import {
  AiAssistantAccessScope,
  AiAssistantShareScope,
} from '../../../interfaces/ai-assistant';
import { isCreatablePagePathPattern } from '../../../utils/is-creatable-page-path-pattern';

export const upsertAiAssistantValidator: ValidationChain[] = [
  body('name')
    .isString()
    .withMessage('name must be a string')
    .not()
    .isEmpty()
    .withMessage('name is required'),

  body('description')
    .optional()
    .isString()
    .withMessage('description must be a string'),

  body('additionalInstruction')
    .optional()
    .isString()
    .withMessage('additionalInstruction must be a string'),

  body('pagePathPatterns')
    .isArray()
    .withMessage('pagePathPatterns must be an array of strings')
    .not()
    .isEmpty()
    .withMessage('pagePathPatterns must not be empty')
    .custom((pagePathPattens: string[]) => {
      if (pagePathPattens.length > 300) {
        throw new Error(
          'pagePathPattens must be an array of strings with a maximum length of 300',
        );
      }

      return true;
    }),

  body('pagePathPatterns.*') // each item of pagePathPatterns
    .isString()
    .withMessage('pagePathPatterns must be an array of strings')
    .notEmpty()
    .withMessage('pagePathPatterns must not be empty')
    .custom((value: string) => {
      return isCreatablePagePathPattern(value);
    }),

  body('grantedGroupsForShareScope')
    .optional()
    .isArray()
    .withMessage('grantedGroupsForShareScope must be an array'),

  body('grantedGroupsForShareScope.*.type') // each item of grantedGroupsForShareScope
    .isIn(Object.values(GroupType))
    .withMessage('Invalid grantedGroupsForShareScope type value'),

  body('grantedGroupsForShareScope.*.item') // each item of grantedGroupsForShareScope
    .isMongoId()
    .withMessage('Invalid grantedGroupsForShareScope item value'),

  body('grantedGroupsForAccessScope')
    .optional()
    .isArray()
    .withMessage('grantedGroupsForAccessScope must be an array'),

  body('grantedGroupsForAccessScope.*.type') // each item of grantedGroupsForAccessScope
    .isIn(Object.values(GroupType))
    .withMessage('Invalid grantedGroupsForAccessScope type value'),

  body('grantedGroupsForAccessScope.*.item') // each item of grantedGroupsForAccessScope
    .isMongoId()
    .withMessage('Invalid grantedGroupsForAccessScope item value'),

  body('shareScope')
    .isIn(Object.values(AiAssistantShareScope))
    .withMessage('Invalid shareScope value'),

  body('accessScope')
    .isIn(Object.values(AiAssistantAccessScope))
    .withMessage('Invalid accessScope value'),
];
