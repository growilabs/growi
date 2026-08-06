import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { mock } from 'vitest-mock-extended';

import G2GDataTransfer from './G2GDataTransfer';

// --- module mocks -----------------------------------------------------------

const useAdminSocket = vi.hoisted(() => vi.fn());
vi.mock('~/features/admin/states/socket-io', () => ({ useAdminSocket }));

const apiv3Get = vi.hoisted(() => vi.fn());
const apiv3Post = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get, apiv3Post }));

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/toastr', () => ({ toastError, toastSuccess }));

vi.mock('~/client/services/g2g-transfer', () => ({
  useGenerateTransferKey: () => ({
    transferKey: '',
    generateTransferKey: vi.fn(),
  }),
}));

vi.mock('~/states/context', () => ({
  useGrowiDocumentationUrl: () => 'https://docs.growi.org',
}));

// The heading `error_send_growi_archive` resolves to in ja_JP/admin.json (verbatim,
// as of this writing). Used below to prove the single-toast behavior for a
// non-conflict key holds under a *translated* heading, not just under en_US where
// the heading happens to read like the pusher's hardcoded English `message`.
const JA_JP_ERROR_SEND_GROWI_ARCHIVE =
  'GROWI アーカイブファイルの送信に失敗しました';

// The pusher's hardcoded English `message` for this key
// (service/g2g-transfer.ts's GENERIC_ARCHIVE_POST_ERROR_EVENT). Never
// translated — it always arrives in this form regardless of the admin's locale.
const PUSHER_ERROR_SEND_GROWI_ARCHIVE_MESSAGE =
  'Failed to send GROWI archive file to the destination GROWI';

// Deliberately reused as both the "translated heading" and the `message` in
// the data-conflict test below, so heading and message are textually
// identical there on purpose (see that test for why).
const CONFLICT_SUMMARY =
  'users: 2 conflicts (email "a@example.com", username "bob"). usergroups: 1 conflict (name "Team X").';

const TRANSLATIONS: Record<string, string> = {
  'admin:g2g:error_send_growi_archive': JA_JP_ERROR_SEND_GROWI_ARCHIVE,
  'admin:g2g:error_data_conflict': CONFLICT_SUMMARY,
};
const t = (key: string) => TRANSLATIONS[key] ?? key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t }) }));

// --- helpers ----------------------------------------------------------------

const socketHandlers = new Map<string, (payload: unknown) => void>();

const renderComponent = () => render(<G2GDataTransfer />);

const fireSocketEvent = async (event: string, payload: unknown) => {
  await act(async () => {
    socketHandlers.get(event)?.(payload);
  });
};

describe('G2GDataTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();

    // No collections: keeps the advanced-options / import-configuration
    // subtree (G2GDataTransferExportForm) out of the render tree, which is
    // irrelevant to the admin:g2gError handling under test here.
    apiv3Get.mockResolvedValue({ data: { collections: [] } });

    const socket = mock<Socket>();
    // socket.io's on() is heavily overloaded; a capturing implementation cannot
    // be expressed through those overload types, so cast this single function
    // (same pattern as ExportArchiveDataPage.spec.tsx).
    socket.on.mockImplementation(((event: string, cb: (p: unknown) => void) => {
      socketHandlers.set(event, cb);
      return socket;
    }) as unknown as typeof socket.on);
    useAdminSocket.mockReturnValue(socket);
  });

  describe('admin:g2gError handling', () => {
    it('shows a single toast for a non-conflict key even when the (untranslated) message differs from the translated heading', async () => {
      // Regression guarded: an earlier implementation decided whether to show
      // `message` by comparing it against the translated heading text. That
      // only avoided a duplicate toast by accident, for locales where the
      // heading happens to read like the pusher's English `message`
      // (en_US, zh_CN — both untranslated). Any locale that actually
      // translates the heading (ja_JP, fr_FR, ko_KR all already do for this
      // key) made the two strings differ, which produced two toasts: one
      // translated, one raw English — a regression from the single toast
      // shown before this feature. This case reproduces that with a real
      // ja_JP heading, and must still yield exactly one toast.
      renderComponent();
      await act(async () => {}); // let the mount effect (setCollectionsAndSelectedCollections) settle

      await fireSocketEvent('admin:g2gError', {
        key: 'admin:g2g:error_send_growi_archive',
        message: PUSHER_ERROR_SEND_GROWI_ARCHIVE_MESSAGE,
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      const [contents] = toastError.mock.calls[0];
      expect((contents as Error[]).map((e) => e.message)).toEqual([
        JA_JP_ERROR_SEND_GROWI_ARCHIVE,
      ]);
    });

    it('shows both the heading and the conflict summary for the data-conflict key, even when their text happens to be identical', async () => {
      // Mirrors the above from the other side: the decision must key off
      // `key`, not off whether the two strings differ. Heading and message
      // are deliberately set to the exact same text here — if the
      // implementation regressed to a text-equality check, this would
      // collapse to a single toast and the conflict detail would be lost
      // (requirements 3.1, 3.2).
      renderComponent();
      await act(async () => {});

      // `t('admin:g2g:error_data_conflict')` resolves to CONFLICT_SUMMARY too
      // (see TRANSLATIONS above), so the heading the component computes and
      // this `message` are byte-for-byte identical.
      await fireSocketEvent('admin:g2gError', {
        key: 'admin:g2g:error_data_conflict',
        message: CONFLICT_SUMMARY,
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      const [contents] = toastError.mock.calls[0];
      // What the admin actually sees: two toasts, heading then detail — not
      // merely "toastError was called".
      expect((contents as Error[]).map((e) => e.message)).toEqual([
        CONFLICT_SUMMARY,
        CONFLICT_SUMMARY,
      ]);
    });
  });

  describe('starting a transfer', () => {
    // The start button is a submit button; happy-dom does not turn a click on one into
    // a form submission, so the form is submitted directly.
    const submitTransferForm = () => {
      const form = screen
        .getByRole('button', { name: 'admin:g2g_data_transfer.start_transfer' })
        .closest('form');
      if (form == null) {
        throw new Error('Expected the start button to sit in a form');
      }
      fireEvent.submit(form);
    };

    it('does not send anything until the maintenance mode notice is acknowledged', async () => {
      // Requirement 2.10 — the destination is left in maintenance mode by the transfer,
      // and the operator has to be told before anything is sent, not after.
      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });
      expect(apiv3Post).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.proceed',
          }),
        );
      });

      expect(apiv3Post).toHaveBeenCalledWith(
        '/g2g-transfer/transfer',
        expect.any(Object),
      );
    });

    it('sends nothing when the operator backs out of the notice', async () => {
      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.cancel',
          }),
        );
      });

      expect(apiv3Post).not.toHaveBeenCalled();
    });
  });
});
