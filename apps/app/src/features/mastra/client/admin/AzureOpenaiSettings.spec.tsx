// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en_US' },
  }),
}));

import type { AzureOpenaiSettingsProps } from './AzureOpenaiSettings';
import { AzureOpenaiSettings } from './AzureOpenaiSettings';

const renderComponent = (overrides: Partial<AzureOpenaiSettingsProps> = {}) => {
  const props: AzureOpenaiSettingsProps = {
    provider: 'azure-openai',
    resourceName: '',
    baseUrl: '',
    apiVersion: '',
    useEntraId: false,
    disabled: false,
    onChangeResourceName: vi.fn(),
    onChangeBaseUrl: vi.fn(),
    onChangeApiVersion: vi.fn(),
    onChangeUseEntraId: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<AzureOpenaiSettings {...props} />) };
};

describe('AzureOpenaiSettings', () => {
  it('renders nothing when the provider is not azure-openai', () => {
    // Act
    const { container } = renderComponent({ provider: 'openai' });

    // Assert
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the four azure fields when the provider is azure-openai', () => {
    // Act
    renderComponent();

    // Assert
    expect(
      screen.getByLabelText('ai_settings.azure_resource_name_label'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('ai_settings.azure_base_url_label'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('ai_settings.azure_api_version_label'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows the Entra ID api-key note only when useEntraId is true', () => {
    // Arrange: note hidden by default
    const { rerender, props } = renderComponent({ useEntraId: false });
    expect(
      screen.queryByText('ai_settings.azure_entra_id_api_key_note'),
    ).not.toBeInTheDocument();

    // Act
    rerender(<AzureOpenaiSettings {...props} useEntraId />);

    // Assert
    expect(
      screen.getByText('ai_settings.azure_entra_id_api_key_note'),
    ).toBeInTheDocument();
  });

  it('calls onChangeUseEntraId with the toggled value', () => {
    // Arrange
    const onChangeUseEntraId = vi.fn();
    renderComponent({ onChangeUseEntraId });

    // Act
    fireEvent.click(screen.getByRole('switch'));

    // Assert
    expect(onChangeUseEntraId).toHaveBeenCalledWith(true);
  });

  it('disables every input (not focusable) in env-only mode', () => {
    // Act
    renderComponent({ disabled: true });

    // Assert: disabled (not readOnly) so the locked fields cannot be focused.
    expect(
      screen.getByLabelText('ai_settings.azure_resource_name_label'),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('ai_settings.azure_base_url_label'),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('ai_settings.azure_api_version_label'),
    ).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
