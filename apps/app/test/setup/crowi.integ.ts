/**
 * Integration test to verify Crowi setup works correctly in Vitest environment.
 * This ensures the test/setup/crowi.ts utility functions properly.
 */

import type Crowi from '~/server/crowi';

import { getInstance, resetInstance } from './crowi';

describe('Crowi Setup for Integration Tests', () => {
  let crowi: Crowi;

  beforeAll(async () => {
    resetInstance();
    crowi = await getInstance();
  });

  it('should create a Crowi instance', () => {
    expect(crowi).toBeDefined();
    expect(crowi.version).toBeDefined();
  });

  it('should have events initialized', () => {
    expect(crowi.events).toBeDefined();
    expect(crowi.events.user).toBeDefined();
    expect(crowi.events.page).toBeDefined();
  });

  it('should have configManager initialized', () => {
    expect(crowi.configManager).toBeDefined();
  });

  it('should have pageService initialized', () => {
    expect(crowi.pageService).toBeDefined();
  });

  it('should have models initialized', () => {
    expect(crowi.models).toBeDefined();
  });

  it('should return singleton instance on subsequent calls', async () => {
    const crowi2 = await getInstance();
    expect(crowi2).toBe(crowi);
  });
});
