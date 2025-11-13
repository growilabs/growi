/*
 * Common types and interfaces
 */

import type { ReactNode } from 'react';

export type HasChildren<T = ReactNode> = {
  children?: T;
};
