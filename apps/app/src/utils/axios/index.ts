/** biome-ignore-all lint/style/noRestrictedImports: This file is an adapter for axios */

import type { AxiosStatic } from 'axios';
import axios from 'axios';

import { createCustomAxios } from './create-custom-axios';

export * from 'axios';

// Create a new object based on axios, but with custom create method
// This avoids mutating the original axios object and prevents infinite recursion
// Order matters: axios static properties first, then custom instance, then override create
const customAxiosStatic = Object.assign({}, axios, createCustomAxios(), {
  // Override only the create method
  create: createCustomAxios,
}) satisfies AxiosStatic;

export default customAxiosStatic;
