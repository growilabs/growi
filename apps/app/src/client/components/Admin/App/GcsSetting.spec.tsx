/**
 * GcsSetting.spec.tsx
 *
 * Regression test: when GROWI.cloud provides GCS as a hosted (env-only)
 * storage, `gcsUseOnlyEnvVars` is true and every GCS setting must be locked
 * to the infra-provided env vars. The file-delivery (relay/redirect) mode
 * dropdown was never gated by this flag, so a hosted-GCS admin could still
 * change and persist it, unlike the other GCS fields.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { UseFormRegister } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import type { FileUploadFormValues } from './FileUploadSetting.types';
import { GcsSettingMolecule } from './GcsSetting';

// GcsSettingMolecule only spreads `register(...)` onto plain text inputs
// that this suite never queries, so an empty-object stub is sufficient.
const register = vi
  .fn()
  .mockReturnValue({}) as unknown as UseFormRegister<FileUploadFormValues>;

const baseProps = {
  register,
  gcsReferenceFileWithRelayMode: false,
  gcsUseOnlyEnvVars: false,
  isCloud: false,
};

describe('GcsSettingMolecule', () => {
  it('allows changing the file-delivery mode when not env-only', () => {
    const onChange = vi.fn();
    render(
      <GcsSettingMolecule
        {...baseProps}
        onChangeGcsReferenceFileWithRelayMode={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'admin:app_setting.file_delivery_method_relay',
      }),
    );

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('locks the file-delivery mode when GCS is env-only (hosted)', () => {
    const onChange = vi.fn();
    render(
      <GcsSettingMolecule
        {...baseProps}
        gcsUseOnlyEnvVars
        onChangeGcsReferenceFileWithRelayMode={onChange}
      />,
    );

    const toggle = document.getElementById('ddGcsReferenceFileWithRelayMode');
    expect(toggle).toBeDisabled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'admin:app_setting.file_delivery_method_relay',
      }),
    );

    expect(onChange).not.toHaveBeenCalled();
  });
});
