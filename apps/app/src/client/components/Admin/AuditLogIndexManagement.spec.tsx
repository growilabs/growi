import { act, render, screen } from '@testing-library/react';

import { AuditLogIndexManagement } from './AuditLogIndexManagement';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseAtomValue = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();
  return { ...actual, useAtomValue: mockUseAtomValue };
});

const mockUseIndexManagement = vi.hoisted(() => vi.fn());
vi.mock('./hooks/useIndexManagement', () => ({
  useIndexManagement: mockUseIndexManagement,
}));

vi.mock('./AuditLog/AuditLogDisableMode', () => ({
  AuditLogDisableMode: () => <div data-testid="audit-log-disable-mode" />,
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
  retrieveStatus: vi.fn(),
  reconnect: vi.fn(),
  normalizeIndices: vi.fn(),
  rebuildIndices: vi.fn(),
};

describe('AuditLogIndexManagement', () => {
  let capturedOnStatusSuccess: ((data: unknown) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAtomValue.mockReturnValue(true);
    capturedOnStatusSuccess = undefined;
    mockUseIndexManagement.mockImplementation(
      ({ onStatusSuccess }: { onStatusSuccess?: (data: unknown) => void }) => {
        capturedOnStatusSuccess = onStatusSuccess;
        return defaultHookValues;
      },
    );
  });

  it('shows AuditLogDisableMode when audit log is disabled', () => {
    mockUseAtomValue.mockReturnValue(false);
    render(<AuditLogIndexManagement />);
    expect(screen.getByTestId('audit-log-disable-mode')).toBeInTheDocument();
  });

  it('renders index management controls when audit log is enabled', () => {
    render(<AuditLogIndexManagement />);
    expect(screen.getByTestId('status-table')).toBeInTheDocument();
    expect(screen.getByTestId('reconnect-controls')).toBeInTheDocument();
  });

  it('shows unsynced events warning when onStatusSuccess reports unsynced events', () => {
    render(<AuditLogIndexManagement />);

    act(() => {
      capturedOnStatusSuccess?.({ auditlogHasUnsyncedEvents: true });
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
