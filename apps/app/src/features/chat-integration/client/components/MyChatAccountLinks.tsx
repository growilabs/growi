// Requirement 7.7's personal-settings tab: shows the current user's own
// chat-account links and lets them unlink each individually. Registered as
// a new entry in `client/components/Me/PersonalSettings.jsx`'s
// `navTabMapping` -- GROWI's personal-settings tabs are enumerated in
// exactly that one place (tasks.md 6.2: "個人設定のタブの一覧に1つ足す。
// 一覧は1つの場所で一元管理されているので、そこに書かないと画面に出ない").
//
// Unlinking calls `DELETE /chat-integration/my-account-links/:id`, which
// deletes the `chat_account_links` row (`manage-account-links-service.ts`).
// That row's absence is the entire mechanism by which a later write from
// the same chat account is refused -- `resolveActor` (task 3.3, unmodified)
// already returns `writeDenied: 'not-linked'` whenever its lookup finds no
// row. Nothing here touches `resolveActor` or GROWI user status.
//
// Follows the same plain hooks + direct apiv3-client convention as task
// 6.1's `AccountLinkApproval.tsx` (no `~/stores/personal-settings` entry
// added -- this feature's own client code talks to its own apiv3 endpoints
// directly, matching that precedent).

import { type JSX, useCallback } from 'react';
import { useTranslation } from 'next-i18next';
import useSWR from 'swr';

import { apiv3Delete, apiv3Get } from '~/client/util/apiv3-client';

export interface ChatAccountLinkListItem {
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly workspaceName: string;
  readonly relationLabel: string | null;
  readonly linkedAt: string;
}

const SWR_KEY = 'chat-integration-my-account-links';

const fetchMyLinks = async (): Promise<ChatAccountLinkListItem[]> => {
  const res = await apiv3Get<{ links: ChatAccountLinkListItem[] }>(
    '/chat-integration/my-account-links',
  );
  return res.data.links;
};

export const MyChatAccountLinks = (): JSX.Element => {
  const { t } = useTranslation();
  const {
    data: links,
    error,
    isLoading,
    mutate,
  } = useSWR(SWR_KEY, fetchMyLinks);

  const handleUnlink = useCallback(
    async (id: string) => {
      await apiv3Delete(`/chat-integration/my-account-links/${id}`);
      mutate();
    },
    [mutate],
  );

  if (isLoading) {
    return <p>Loading…</p>;
  }

  if (error) {
    return <p>Failed to load your linked chat accounts.</p>;
  }

  return (
    <div data-testid="grw-chat-account-links">
      <h2 className="border-bottom mt-4 pb-2 fs-4">Linked Chat Accounts</h2>

      {(links == null || links.length === 0) && (
        <p>No chat accounts are linked yet.</p>
      )}

      {links != null && links.length > 0 && (
        <table className="table table-bordered">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Workspace</th>
              <th>Chat account</th>
              <th>Linked at</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <td>{link.platform}</td>
                <td>{link.relationLabel ?? link.workspaceName}</td>
                <td>{link.accountId}</td>
                <td>{new Date(link.linkedAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => handleUnlink(link.id)}
                  >
                    {t('Disassociate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
