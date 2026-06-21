// @vitest-environment jsdom
import { Prec } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';

import { getKeymap } from './index';

describe('getKeymap', () => {
  it('should return low precedence and no overrides for default mode', async () => {
    const result = await getKeymap();
    expect(result.extension).toBeDefined();
    expect(result.precedence).toBe(Prec.low);
    expect(result.overrides).toEqual([]);
  });

  it('should return low precedence and no overrides for vscode mode', async () => {
    const result = await getKeymap('vscode');
    expect(result.extension).toBeDefined();
    expect(result.precedence).toBe(Prec.low);
    expect(result.overrides).toEqual([]);
  });

  it('should return high precedence and no overrides for vim mode', async () => {
    const result = await getKeymap('vim');
    expect(result.extension).toBeDefined();
    expect(result.precedence).toBe(Prec.high);
    expect(result.overrides).toEqual([]);
  });

  it('should return high precedence with formatting and structural overrides for emacs mode', async () => {
    const result = await getKeymap('emacs');
    expect(result.extension).toBeDefined();
    expect(result.precedence).toBe(Prec.high);
    expect(result.overrides).toContain('formatting');
    expect(result.overrides).toContain('structural');
  });

  it('should pass onSave to vim mode and register :w command', async () => {
    const onSave = vi.fn();
    const result = await getKeymap('vim', onSave);
    expect(result.extension).toBeDefined();
  });

  it('should pass onSave to emacs mode for C-x C-s binding', async () => {
    const onSave = vi.fn();
    const result = await getKeymap('emacs', onSave);
    expect(result.extension).toBeDefined();
  });
});
