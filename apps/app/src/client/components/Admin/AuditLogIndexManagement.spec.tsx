import { act, render, screen } from '@testing-library/react';

import { AuditLogIndexManagement } from './AuditLogIndexManagement';
import type { IndexManagementStatusResponse } from './hooks/useIndexManagement';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseAtomValue = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();
  return { ...actual, useAtomValue: mockUseAtomValue };
});

const mockUseGrowiCloudUri = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockUseGrowiAppIdForGrowiCloud = vi.hoisted(() =>
  vi.fn().mockReturnValue(null),
);
vi.mock('~/states/global', () => ({
  useGrowiCloudUri: mockUseGrowiCloudUri,
  useGrowiAppIdForGrowiCloud: mockUseGrowiAppIdForGrowiCloud,
}));

const mockUseIndexManagement = vi.hoisted(() => vi.fn());
vi.mock('./hooks/useIndexManagement', () => ({
  useIndexManagement: mockUseIndexManagement,
}));

vi.mock('./ElasticsearchManagement/StatusTable', () => ({
  default: () => <div data-testid="status-table" />,
}));

vi.mock('./ElasticsearchManagement/ReconnectControls', () => ({
  default: () => <div data-testid="reconnect-controls" />,
}));

vi.mock('./Common/LabeledProgressBar', () => ({
  default: () => <div data-testid="progress-bar" />,
}));

const defaultHookValues = {
  isInitialized: true,
  isConnected: true,
  isConfigured: true,
  isReconnectingProcessing: false,
  isNormalizingProcessing: false,
  isRebuildingProcessing: false,
  isRebuildingCompleted: false,
  isNormalized: true,
  indicesData: null,
  aliasesData: null,
  rebuildTotal: 0,
  rebuildCurrent: 0,
  isErrorOccuredOnSearchService: false,
  isReconnectBtnEnabled: false,
  isNormalizeEnabled: false,
  isRebuildEnabled: true,
  reconnect: vi.fn(),
  normalizeIndices: vi.fn(),
  rebuildIndices: vi.fn(),
};

describe('AuditLogIndexManagement', () => {
  let capturedOnStatusSuccess:
    | ((data: IndexManagementStatusResponse) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAtomValue.mockReturnValue(true);
    mockUseGrowiCloudUri.mockReturnValue(null);
    mockUseGrowiAppIdForGrowiCloud.mockReturnValue(null);
    capturedOnStatusSuccess = undefined;
    mockUseIndexManagement.mockImplementation(
      ({
        onStatusSuccess,
      }: {
        onStatusSuccess?: (data: IndexManagementStatusResponse) => void;
      }) => {
        capturedOnStatusSuccess = onStatusSuccess;
        return defaultHookValues;
      },
    );
  });

  it('shows a compact disabled placeholder when audit log is disabled', () => {
    mockUseAtomValue.mockReturnValue(false);
    render(<AuditLogIndexManagement />);
    expect(
      screen.getByTestId('admin-audit-log-index-disabled'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('status-table')).not.toBeInTheDocument();
  });

  it('shows the self-hosted explanation, not the cloud one, when not on GROWI.cloud', () => {
    mockUseAtomValue.mockReturnValue(false);
    render(<AuditLogIndexManagement />);

    expect(
      screen.getByText('audit_log_management.disable_mode_explanation'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('audit_log_management.disable_mode_explanation_cloud'),
    ).not.toBeInTheDocument();
  });

  it('shows the cloud explanation and a link to cloud settings on GROWI.cloud', () => {
    mockUseAtomValue.mockReturnValue(false);
    mockUseGrowiCloudUri.mockReturnValue('https://growi.cloud');
    mockUseGrowiAppIdForGrowiCloud.mockReturnValue('app-id');
    render(<AuditLogIndexManagement />);

    expect(
      screen.getByText('audit_log_management.disable_mode_explanation_cloud'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('audit_log_management.disable_mode_explanation'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /cloud_setting_management\.to_cloud_settings/,
      }),
    ).toHaveAttribute('href', 'https://growi.cloud/my/apps/app-id');
  });

  it('tells useIndexManagement it is disabled, so it skips the status fetch', () => {
    mockUseAtomValue.mockReturnValue(false);
    render(<AuditLogIndexManagement />);

    expect(mockUseIndexManagement).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('renders index management controls when audit log is enabled', () => {
    render(<AuditLogIndexManagement />);
    expect(screen.getByTestId('status-table')).toBeInTheDocument();
    expect(screen.getByTestId('reconnect-controls')).toBeInTheDocument();
  });

  it('shows unsynced events warning when onStatusSuccess reports unsynced events', () => {
    render(<AuditLogIndexManagement />);

    act(() => {
      capturedOnStatusSuccess?.({
        info: { isNormalized: true, indices: null, aliases: null },
        auditlogHasUnsyncedEvents: true,
      });
    });

    expect(
      screen.getByText('audit_log_index_management.unsynced_events_warning'),
    ).toBeInTheDocument();
  });

  it('does not show unsynced events warning by default', () => {
    render(<AuditLogIndexManagement />);
    expect(
      screen.queryByText('audit_log_index_management.unsynced_events_warning'),
    ).not.toBeInTheDocument();
  });
});
