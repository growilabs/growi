import { fireEvent, render } from '@testing-library/react';
import { useForm } from 'react-hook-form';

import { AwsSettingMolecule } from './AwsSetting';
import { AzureSettingMolecule } from './AzureSetting';
import type { FileUploadFormValues } from './FileUploadSetting.types';
import { GcsSettingMolecule } from './GcsSetting';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const Harness = ({
  provider,
  locked,
  onChange,
}: {
  provider: 'aws' | 'gcs' | 'azure';
  locked: boolean;
  onChange: (value: boolean) => void;
}) => {
  const { register } = useForm<FileUploadFormValues>();
  if (provider === 'aws') {
    return (
      <AwsSettingMolecule
        register={register}
        awsUseOnlyEnvVars={locked}
        s3ReferenceFileWithRelayMode={false}
        onChangeS3ReferenceFileWithRelayMode={onChange}
      />
    );
  }
  if (provider === 'gcs') {
    return (
      <GcsSettingMolecule
        register={register}
        gcsUseOnlyEnvVars={locked}
        gcsReferenceFileWithRelayMode={false}
        onChangeGcsReferenceFileWithRelayMode={onChange}
        isCloud={false}
      />
    );
  }
  return (
    <AzureSettingMolecule
      register={register}
      azureUseOnlyEnvVars={locked}
      azureReferenceFileWithRelayMode={false}
      onChangeAzureReferenceFileWithRelayMode={onChange}
      isCloud={false}
    />
  );
};

describe.each([
  'aws',
  'gcs',
  'azure',
] as const)('%s storage settings', (provider) => {
  it('locks all configured fields and delivery-mode choices when hosted', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Harness provider={provider} locked onChange={onChange} />,
    );
    const inputs = container.querySelectorAll(
      'input[name]:not([tabindex="-1"])',
    );
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toHaveAttribute('readonly');
    }
    const choices =
      container.querySelectorAll<HTMLButtonElement>('.dropdown button');
    expect(choices).toHaveLength(3);
    for (const button of choices) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps fields editable and delivery mode selectable when owned', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Harness provider={provider} locked={false} onChange={onChange} />,
    );
    const inputs = container.querySelectorAll(
      'input[name]:not([tabindex="-1"])',
    );
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).not.toHaveAttribute('readonly');
    }
    const buttons =
      container.querySelectorAll<HTMLButtonElement>('.dropdown button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toBeEnabled();
    const relay = container.querySelector<HTMLButtonElement>('.dropdown-item');
    expect(relay).not.toBeNull();
    if (relay) fireEvent.click(relay);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
