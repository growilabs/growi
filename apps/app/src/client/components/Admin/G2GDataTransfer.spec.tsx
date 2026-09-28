import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

// The default preflight report used unless a test overrides `apiv3Post`'s
// implementation for '/g2g-transfer/preflight' -- an empty, warning-free destination.
const DEFAULT_PREFLIGHT_RESULT = {
  destinationCounts: { users: 0, userGroups: 0, pages: 0 },
  blockers: [],
  warnings: [],
};

// `apiv3Post` is shared by the preflight check and the actual transfer request; tests
// that care about one specific call look it up by URL rather than assuming an index,
// since preflight now always fires first.
const mockApiv3PostDefaults = () => {
  apiv3Post.mockImplementation((url: string) => {
    if (url === '/g2g-transfer/preflight') {
      return Promise.resolve({ data: DEFAULT_PREFLIGHT_RESULT });
    }
    return Promise.resolve({ data: {} });
  });
};

const transferRequestCall = () =>
  apiv3Post.mock.calls.find(
    ([url]: [string, unknown]) => url === '/g2g-transfer/transfer',
  );

const socketHandlers = new Map<string, (payload: unknown) => void>();

const renderComponent = () => render(<G2GDataTransfer />);

const fireSocketEvent = async (event: string, payload: unknown) => {
  await act(async () => {
    socketHandlers.get(event)?.(payload);
  });
};

// The start button is a submit button; happy-dom does not turn a click on one into a
// form submission, so the form is submitted directly. Shared by both the
// "transfer method selection" and "starting a transfer" describe blocks below.
const submitTransferForm = () => {
  const form = screen
    .getByRole('button', { name: 'admin:g2g_data_transfer.start_transfer' })
    .closest('form');
  if (form == null) {
    throw new Error('Expected the start button to sit in a form');
  }
  fireEvent.submit(form);
};

describe('G2GDataTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers.clear();

    // No collections: keeps the advanced-options / import-configuration
    // subtree (G2GDataTransferExportForm) out of the render tree, which is
    // irrelevant to the admin:g2gError handling under test here.
    apiv3Get.mockResolvedValue({ data: { collections: [] } });
    mockApiv3PostDefaults();

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

  describe('transfer method selection', () => {
    const migrationRadio = () =>
      screen.getByRole('radio', {
        name: 'admin:g2g_data_transfer.transfer_method.migration',
      });
    const mergeRadio = () =>
      screen.getByRole('radio', {
        name: 'admin:g2g_data_transfer.transfer_method.merge',
      });

    it('selects "migration" initially and renders neither the collection selection nor the import-method selection', async () => {
      // Requirements 1.1, 1.2.
      apiv3Get.mockResolvedValue({
        data: { collections: ['usergroups', 'configs'] },
      });
      renderComponent();
      await act(async () => {});

      expect(migrationRadio()).toBeChecked();
      expect(mergeRadio()).not.toBeChecked();
      // The collection checkbox (rendered by G2GDataTransferExportForm, labeled
      // with the collection name) must not be in the tree at all -- not merely
      // hidden -- while "migration" is selected.
      expect(screen.queryByLabelText('usergroups')).not.toBeInTheDocument();
    });

    it('renders both the collection selection and the import-method selection once "merge" is chosen', async () => {
      // Requirement 1.4.
      apiv3Get.mockResolvedValue({
        data: { collections: ['usergroups', 'configs'] },
      });
      renderComponent();
      await act(async () => {});

      await act(async () => {
        fireEvent.click(mergeRadio());
      });

      expect(screen.getByLabelText('usergroups')).toBeInTheDocument();
      expect(screen.getByLabelText('configs')).toBeInTheDocument();

      // Import-method selection: each rendered collection carries a "Mode:" label
      // next to its method dropdown (G2GDataTransferExportForm.spec.tsx pins
      // which methods that dropdown offers per collection; this only proves the
      // selector itself is actually mounted on this screen once "merge" is
      // chosen, which is what this test's name claims).
      const usergroupsCard = screen
        .getByLabelText('usergroups')
        .closest('.card') as HTMLElement | null;
      if (usergroupsCard == null) {
        throw new Error('Expected a .card ancestor for usergroups');
      }
      expect(within(usergroupsCard).getByText(/Mode:/)).toBeInTheDocument();
    });

    it('replaces every transferable collection when "migration" is sent, not whatever the (never-shown) merge selection would have been', async () => {
      // Requirement 1.2. Distinguishes correct wiring from a bug that keeps using
      // the merge preset's plan-builder regardless of the chosen preset: that
      // bug would send an empty optionsMap (G2GDataTransferExportForm, which
      // populates it, never mounts under "migration"), which the assertions
      // below on `mode` would catch.
      apiv3Get.mockResolvedValue({
        data: { collections: ['usergroups', 'configs', 'pages'] },
      });
      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.proceed',
          }),
        );
      });

      expect(apiv3Post).toHaveBeenCalledWith(
        '/g2g-transfer/transfer',
        expect.objectContaining({
          collections: ['usergroups', 'configs', 'pages'],
        }),
      );
      // Preflight fires first (it always precedes the confirm modal), so the transfer
      // request is looked up by URL rather than assumed to be the first call.
      const transferCall = transferRequestCall();
      if (transferCall == null) {
        throw new Error('Expected a call to /g2g-transfer/transfer');
      }
      const [, body] = transferCall as [string, Record<string, any>];
      expect(body.optionsMap.usergroups.mode).toBe('flushAndInsert');
      expect(body.optionsMap.configs.mode).toBe('flushAndInsert');
      expect(body.optionsMap.pages.mode).toBe('flushAndInsert');
      // `pages` must carry the extra options key, or the receiving side's
      // import-setting generation throws before anything is imported (see
      // g2g-transfer-preset.ts).
      expect(body.optionsMap.pages).toHaveProperty(
        'isOverwriteAuthorWithCurrentUser',
      );
    });
  });

  describe('starting a transfer', () => {
    it('checks preflight but sends nothing to /transfer until the confirm modal is acknowledged', async () => {
      // Requirements 3.2, 3.3 — nothing is sent (no archive, no request to the
      // destination) until the operator confirms. The confirm modal also folds in
      // the former separate maintenance-mode notice (task 4.4), so the same button
      // ('maintenance_mode_notice.proceed', reused rather than duplicated) both
      // acknowledges the notice and starts the transfer.
      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });
      // The preflight check itself is a read; only the transfer request would change
      // the destination, and that must not have happened yet.
      expect(apiv3Post).toHaveBeenCalledWith(
        '/g2g-transfer/preflight',
        expect.any(Object),
      );
      expect(transferRequestCall()).toBeUndefined();

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

    it('sends nothing to /transfer when the operator backs out of the confirm modal, and the destination is never touched', async () => {
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

      expect(transferRequestCall()).toBeUndefined();
    });

    it('shows an error and does not open the confirm modal when the preflight check fails', async () => {
      // A failed preflight must leave the destination exactly as untouched as
      // declining to confirm does -- the modal never opens, so there is no
      // confirm button to accidentally click through.
      const preflightError = [new Error('preflight failed')];
      apiv3Post.mockImplementation((url: string) => {
        if (url === '/g2g-transfer/preflight') {
          return Promise.reject(preflightError);
        }
        return Promise.resolve({ data: {} });
      });

      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });

      expect(toastError).toHaveBeenCalledWith(preflightError);
      expect(
        screen.queryByRole('button', {
          name: 'maintenance_mode_notice.proceed',
        }),
      ).not.toBeInTheDocument();
    });

    it('shows the blockers and does not open the confirm modal when the preflight check reports one', async () => {
      // The cheapest fix noted in the spec's Implementation Notes for "the confirm
      // modal doesn't show blockers": check preflight's blockers before ever opening
      // the modal, client-side only, rather than letting the operator confirm a
      // destructive migration only to be refused afterwards by the execution-time
      // re-check (task 10.2).
      apiv3Post.mockImplementation((url: string) => {
        if (url === '/g2g-transfer/preflight') {
          return Promise.resolve({
            data: {
              destinationCounts: { users: 0, userGroups: 0, pages: 0 },
              blockers: [
                { type: 'version_mismatch', src: '8.0.0', dest: '7.5.0' },
              ],
              warnings: [],
            },
          });
        }
        return Promise.resolve({ data: {} });
      });

      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });

      expect(toastError).toHaveBeenCalledWith([
        new Error('g2g_data_transfer.blockers.version_mismatch'),
      ]);
      expect(
        screen.queryByRole('button', {
          name: 'maintenance_mode_notice.proceed',
        }),
      ).not.toBeInTheDocument();
      expect(transferRequestCall()).toBeUndefined();
    });

    it('passes the preflight response through to the confirm modal (wiring), not a hardcoded value', async () => {
      // Requirement 3.1. This checks the wiring between G2GDataTransfer and the modal
      // it renders -- that the fetched response reaches `preflightResult` unchanged --
      // not the modal's own rendering rules (covered by G2GTransferConfirmModal.spec.tsx).
      // A distinctive fixture (5/2/11) proves the value comes from the server rather
      // than a fixed or empty placeholder; each assertion names the exact translation
      // key + count text the component renders (this file's `t` mock returns the raw
      // key when untranslated), rather than a document-wide "ends with a number" guess.
      apiv3Post.mockImplementation((url: string) => {
        if (url === '/g2g-transfer/preflight') {
          return Promise.resolve({
            data: {
              destinationCounts: { users: 5, userGroups: 2, pages: 11 },
              blockers: [],
              warnings: [],
            },
          });
        }
        return Promise.resolve({ data: {} });
      });

      // The default preset is "migration" (requirement 1.1), which is what renders
      // the counts at all -- see G2GTransferConfirmModal.spec.tsx for the "merge"
      // preset hiding them.
      renderComponent();
      await act(async () => {});

      await act(async () => {
        submitTransferForm();
      });

      expect(
        screen.getByText('g2g_data_transfer.confirm_modal.counts.users: 5'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'g2g_data_transfer.confirm_modal.counts.user_groups: 2',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('g2g_data_transfer.confirm_modal.counts.pages: 11'),
      ).toBeInTheDocument();
    });
  });

  describe('rescue outcome notification', () => {
    // Requirements 4.6, 4.10 -- what the pusher read out of the destination's response
    // body and put on the completion notification must reach the operator: the renamed
    // `username`, what was dropped, and whether the identifier was reassigned.
    const startTransferAndAcknowledge = async () => {
      renderComponent();
      await act(async () => {});
      await act(async () => {
        submitTransferForm();
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.proceed',
          }),
        );
      });
    };

    it('shows the renamed username and every dropped item when the completion notification carries a rescue outcome', async () => {
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'COMPLETED',
        attachments: 'COMPLETED',
        rescue: {
          rescued: [
            {
              originalUsername: 'admin',
              rescuedUsername: 'admin-rescued',
              emailRemoved: true,
              slackMemberIdRemoved: true,
              idReassigned: true,
            },
          ],
        },
      });

      expect(screen.getByText('admin-rescued')).toBeInTheDocument();
      expect(
        screen.getByText(/rescue_outcome\.renamed_from: admin/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'admin:g2g_data_transfer.rescue_outcome.email_removed',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'admin:g2g_data_transfer.rescue_outcome.slack_member_id_removed',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'admin:g2g_data_transfer.rescue_outcome.id_reassigned',
        ),
      ).toBeInTheDocument();
    });

    it('shows neither the "renamed from" note nor any dropped-item note when the rescued admin kept everything', async () => {
      // Distinguishes "the rescue happened" from "something was dropped/renamed" --
      // rendering unconditionally on every field regardless of its value would pass the
      // test above without actually reading the per-field booleans.
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'COMPLETED',
        attachments: 'COMPLETED',
        rescue: {
          rescued: [
            {
              originalUsername: 'admin',
              rescuedUsername: 'admin',
              emailRemoved: false,
              slackMemberIdRemoved: false,
              idReassigned: false,
            },
          ],
        },
      });

      expect(screen.getByText('admin')).toBeInTheDocument();
      expect(screen.queryByText(/renamed_from/)).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'admin:g2g_data_transfer.rescue_outcome.email_removed',
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'admin:g2g_data_transfer.rescue_outcome.slack_member_id_removed',
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'admin:g2g_data_transfer.rescue_outcome.id_reassigned',
        ),
      ).not.toBeInTheDocument();
    });

    it('shows nothing when the completion notification carries no rescue outcome', async () => {
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'COMPLETED',
        attachments: 'COMPLETED',
      });

      expect(
        screen.queryByText('admin:g2g_data_transfer.rescue_outcome.heading'),
      ).not.toBeInTheDocument();
    });

    it('keeps the rescued username on screen after a later admin:g2gError hides the progress icons (requirement 4.8)', async () => {
      // A migration whose import partly failed emits `admin:g2gProgress` (with the
      // rescue outcome) followed by `admin:g2gError` (server/service/g2g-transfer.ts's
      // `reportIncompleteImport`, right after the completion progress event). The error
      // event sets `isTransferring` to false, which used to unmount this whole panel --
      // taking the rescued username with it, in exactly the scenario (destination left
      // half migrated, reachable only through the rescued administrator account) where
      // the operator needs it most.
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'ERROR',
        attachments: 'ERROR',
        failedCollections: ['pages'],
        rescue: {
          rescued: [
            {
              originalUsername: 'admin',
              rescuedUsername: 'admin-rescued',
              emailRemoved: false,
              slackMemberIdRemoved: false,
              idReassigned: false,
            },
          ],
        },
      });
      await fireSocketEvent('admin:g2gError', {
        key: 'admin:g2g:error_partial_import',
        message: 'Collections that could not be imported: pages',
      });

      expect(screen.getByText('admin-rescued')).toBeInTheDocument();
    });

    it("clears the previous transfer's rescue list when a later attempt is refused before any progress event arrives", async () => {
      // The execution-time re-check (task 10.2) can refuse a second transfer attempt
      // before a single `admin:g2gProgress` event is emitted for it, so without a
      // reset at the start of `startTransfer` the previous transfer's rescue list
      // (and its stale COMPLETED icons) would sit on screen right next to this
      // attempt's refusal toast, as if they belonged to it.
      let transferCallCount = 0;
      apiv3Post.mockImplementation((url: string) => {
        if (url === '/g2g-transfer/preflight') {
          return Promise.resolve({ data: DEFAULT_PREFLIGHT_RESULT });
        }
        if (url === '/g2g-transfer/transfer') {
          transferCallCount += 1;
          // First attempt succeeds; the second is refused by the server-side
          // re-check, exactly like a destination that drifted into a blocked state
          // between the confirm modal and this second attempt (requirement 3.2's
          // server-side counterpart).
          return transferCallCount === 1
            ? Promise.resolve({ data: {} })
            : Promise.reject([new Error('growi_incompatible_to_transfer')]);
        }
        return Promise.resolve({ data: {} });
      });

      renderComponent();
      await act(async () => {});

      // First transfer: succeeds and reports a rescue.
      await act(async () => {
        submitTransferForm();
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.proceed',
          }),
        );
      });
      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'COMPLETED',
        attachments: 'COMPLETED',
        rescue: {
          rescued: [
            {
              originalUsername: 'admin',
              rescuedUsername: 'admin-rescued',
              emailRemoved: false,
              slackMemberIdRemoved: false,
              idReassigned: false,
            },
          ],
        },
      });
      expect(screen.getByText('admin-rescued')).toBeInTheDocument();

      // Second attempt: refused before its own progress event ever arrives.
      await act(async () => {
        submitTransferForm();
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.proceed',
          }),
        );
      });

      // Proves the refusal path was actually exercised, not skipped.
      expect(toastError).toHaveBeenCalled();
      expect(screen.queryByText('admin-rescued')).not.toBeInTheDocument();
    });
  });

  describe('failed collections notification', () => {
    // Requirement 2.8 -- the destination's own list of collections it could not import
    // must reach the operator, not just the generic "transfer incomplete" toast.
    const startTransferAndAcknowledge = async () => {
      renderComponent();
      await act(async () => {});
      await act(async () => {
        submitTransferForm();
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'maintenance_mode_notice.proceed',
          }),
        );
      });
    };

    it('lists the failed collections when the completion notification carries them', async () => {
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'ERROR',
        attachments: 'COMPLETED',
        failedCollections: ['pages', 'pagetagrelations'],
      });

      expect(
        screen.getByText('admin:g2g_data_transfer.failed_collections_heading'),
      ).toBeInTheDocument();
      expect(screen.getByText('pages')).toBeInTheDocument();
      expect(screen.getByText('pagetagrelations')).toBeInTheDocument();
    });

    it('shows nothing when the completion notification carries no failed collections', async () => {
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'COMPLETED',
        attachments: 'COMPLETED',
      });

      expect(
        screen.queryByText(
          'admin:g2g_data_transfer.failed_collections_heading',
        ),
      ).not.toBeInTheDocument();
    });

    it('keeps the failed collections on screen after a later admin:g2gError hides the progress icons', async () => {
      // Same reasoning as the rescue outcome panel above: `isTransferring` flips to
      // `false` when `reportIncompleteImport`'s `admin:g2gError` arrives right after this
      // event, and the operator needs this list precisely when that happens.
      await startTransferAndAcknowledge();

      await fireSocketEvent('admin:g2gProgress', {
        mongo: 'ERROR',
        attachments: 'ERROR',
        failedCollections: ['pages'],
      });
      await fireSocketEvent('admin:g2gError', {
        key: 'admin:g2g:error_partial_import',
        message: 'Collections that could not be imported: pages',
      });

      expect(screen.getByText('pages')).toBeInTheDocument();
    });
  });
});
