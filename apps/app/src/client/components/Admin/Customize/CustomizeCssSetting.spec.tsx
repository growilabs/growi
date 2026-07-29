import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'unstated';
import { mock } from 'vitest-mock-extended';

import AdminCustomizeContainer from '~/client/services/AdminCustomizeContainer';
import { apiv3Put } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useNextThemes } from '~/stores-universal/use-next-themes';

import CustomizeCssSetting from './CustomizeCssSetting';

vi.mock('~/client/util/apiv3-client');
vi.mock('~/client/util/toastr');
vi.mock('~/stores-universal/use-next-themes');

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockedApiv3Put = vi.mocked(apiv3Put);

// Derive the resolved response type from apiv3Put itself, so we neither import
// `AxiosResponse` from 'axios' (lint-restricted) nor cast.
type Apiv3PutResponse = Awaited<ReturnType<typeof apiv3Put>>;

const renderSetting = (container: AdminCustomizeContainer) =>
  render(
    <Provider inject={[container]}>
      <CustomizeCssSetting />
    </Provider>,
  );

/**
 * These tests exercise the register() -> <Controller> migration (the riskiest
 * part of the syntax-highlighting change): they verify that value sync, the
 * save path and the retrieveError guard survive the switch away from a native
 * <textarea>, from the container boundary the admin observes.
 */
describe('CustomizeCssSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNextThemes).mockReturnValue(
      mock<ReturnType<typeof useNextThemes>>({ isDarkMode: false }),
    );
  });

  it('syncs the current CSS from the container into the editor', async () => {
    const container = new AdminCustomizeContainer();
    await container.setState({ currentCustomizeCss: 'body { color: red; }' });

    const { container: dom } = renderSetting(container);

    await waitFor(() => {
      expect(dom.querySelector('.cm-content')?.textContent).toContain(
        'body { color: red; }',
      );
    });
  });

  it('saves the current CSS and shows a success toast on submit', async () => {
    mockedApiv3Put.mockResolvedValue(
      mock<Apiv3PutResponse>({
        data: { customizedParams: { customizeCss: 'body { color: red; }' } },
      }),
    );
    const container = new AdminCustomizeContainer();
    await container.setState({ currentCustomizeCss: 'body { color: red; }' });

    const { getByRole } = renderSetting(container);

    await userEvent.click(getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(mockedApiv3Put).toHaveBeenCalledWith(
        '/customize-setting/customize-css',
        { customizeCss: 'body { color: red; }' },
      );
    });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows an error toast when saving fails', async () => {
    mockedApiv3Put.mockRejectedValue(new Error('network error'));
    const container = new AdminCustomizeContainer();
    await container.setState({ currentCustomizeCss: 'body {}' });

    const { getByRole } = renderSetting(container);

    await userEvent.click(getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(1);
    });
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('disables the Update button while the container is in a retrieve error state', async () => {
    const container = new AdminCustomizeContainer();
    await container.setState({
      retrieveError: new Error('failed to retrieve'),
    });

    const { getByRole } = renderSetting(container);

    expect(getByRole('button', { name: 'Update' })).toBeDisabled();
  });
});
