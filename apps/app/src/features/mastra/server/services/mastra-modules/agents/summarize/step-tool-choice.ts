import { isPageReadBudgetExhausted } from './page-read-budget';
import type { PageReadBudget } from './request-context';

/**
 * Tools are withdrawn once the read budget is spent, and on the last step, so
 * the run always ends by writing the summary instead of calling a tool.
 * `stepNumber` is 0-indexed, as Mastra's prepareStep passes it.
 */
export const resolveStepToolChoice = (
  budget: PageReadBudget,
  stepNumber: number,
  maxSteps: number,
): { toolChoice: 'none' } | undefined =>
  isPageReadBudgetExhausted(budget) || stepNumber >= maxSteps - 1
    ? { toolChoice: 'none' }
    : undefined;
