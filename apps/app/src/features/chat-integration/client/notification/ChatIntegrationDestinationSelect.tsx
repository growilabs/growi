// Requirement 2.2's save-time destination picker: the person saving a page
// chooses which Gen 2 channel(s) the notification goes to.
//
// This is NOT the admin settings screen's destination editor
// (`client/admin/NotificationDestinationsSection.tsx`, Requirement 2.1),
// which configures standing "any page under this path notifies this
// channel" rules. This one is a per-save choice and is available to any
// editor.
//
// Two things are deliberate:
//
//   - The channel is PICKED FROM A LIST, never typed. What leaves this
//     component is `{ relationId, platform, channelId }` -- taken from the
//     fetched list, never parsed back out of the option's value -- which
//     is exactly `IApiv3ChatIntegrationDestinationInput`, the field the
//     page create/update endpoints already accept. No channel NAME is ever
//     sent: names drift, identifiers do not.
//   - It sits ALONGSIDE Gen 1's own `SlackNotification` free-text field
//     and shares no state with it. Gen 1's behaviour is untouched, and Gen
//     2 works whether Gen 1 is configured or not (Requirements 12.1-12.3).
//
// The control is a one-line toggle button plus a checkbox menu (the same
// shape as `GrantSelector`), so its height does not depend on how many
// channels exist. A multi-select `<select>` grows with its options and
// pushes the whole save bar taller.
//
// Renders nothing at all when no channel is available -- an instance with
// no Gen 2 workspace paired sees no change to the save controls.

import { type JSX, useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Dropdown, DropdownMenu, DropdownToggle } from 'reactstrap';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IApiv3ChatIntegrationDestinationInput } from '~/interfaces/apiv3/page';

interface SaveTimeChannelOption {
  readonly relationId: string;
  readonly workspaceName: string;
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
}

interface UnavailableRelation {
  readonly relationId: string;
  readonly workspaceName: string;
  readonly reason: string;
}

interface SaveTimeChannelsView {
  readonly channels: readonly SaveTimeChannelOption[];
  readonly unavailableRelations: readonly UnavailableRelation[];
}

const ENDPOINT = '/chat-integration/notification-channels';

/**
 * Identity of a channel within the list. A channel id alone is not unique:
 * the same id can exist in two paired workspaces.
 */
const keyOf = (relationId: string, channelId: string): string =>
  `${relationId} ${channelId}`;

const fetchChannels = async (): Promise<SaveTimeChannelsView> => {
  const res = await apiv3Get<SaveTimeChannelsView>(ENDPOINT);
  return res.data;
};

/** Channels grouped per workspace, keeping the fetched order. */
const groupByRelation = (
  channels: readonly SaveTimeChannelOption[],
): ReadonlyArray<{
  relationId: string;
  workspaceName: string;
  channels: SaveTimeChannelOption[];
}> => {
  const groups = new Map<
    string,
    {
      relationId: string;
      workspaceName: string;
      channels: SaveTimeChannelOption[];
    }
  >();
  for (const channel of channels) {
    const group = groups.get(channel.relationId);
    if (group == null) {
      groups.set(channel.relationId, {
        relationId: channel.relationId,
        workspaceName: channel.workspaceName,
        channels: [channel],
      });
    } else {
      group.channels.push(channel);
    }
  }
  return [...groups.values()];
};

const focusOnMount = (element: HTMLInputElement | null): void => {
  element?.focus({ preventScroll: true });
};

export const ChatIntegrationDestinationSelect = ({
  destinations,
  onChange,
  openInModal,
}: {
  destinations: readonly IApiv3ChatIntegrationDestinationInput[];
  onChange: (
    destinations: readonly IApiv3ChatIntegrationDestinationInput[],
  ) => void;
  /** Open the menu downward inside the modal; upward from the bottom bar otherwise (same as `GrantSelector`). */
  openInModal?: boolean;
}): JSX.Element | null => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Not revalidated on focus: the list changes only when an administrator
  // pairs a workspace, and a refetch mid-edit could drop a channel the
  // editor has already selected.
  const { data } = useSWR<SaveTimeChannelsView>(ENDPOINT, fetchChannels, {
    revalidateOnFocus: false,
  });

  // Safe with `id=`/`htmlFor=` -- see apps/app/.claude/rules/ui-pitfalls.md.
  const idPrefix = useId();

  const groups = useMemo(() => groupByRelation(data?.channels ?? []), [data]);

  const selectedKeys = useMemo(
    () =>
      new Set(
        destinations.map((destination) =>
          keyOf(destination.relationId, destination.channelId),
        ),
      ),
    [destinations],
  );

  const handleToggleChannel = useCallback(
    (toggled: SaveTimeChannelOption, checked: boolean) => {
      const toggledKey = keyOf(toggled.relationId, toggled.channelId);
      // Output follows the order of the list, whatever order the boxes
      // were checked in. Only the three fields the server's input type
      // declares: the name stays on the client, as a label.
      const picked: IApiv3ChatIntegrationDestinationInput[] = [];
      for (const channel of data?.channels ?? []) {
        const key = keyOf(channel.relationId, channel.channelId);
        const isSelected = key === toggledKey ? checked : selectedKeys.has(key);
        if (isSelected) {
          picked.push({
            relationId: channel.relationId,
            platform: channel.platform,
            channelId: channel.channelId,
          });
        }
      }
      onChange(picked);
    },
    [data, onChange, selectedKeys],
  );

  if (data == null || data.channels.length === 0) {
    return null;
  }

  const selectedChannels = data.channels.filter((channel) =>
    selectedKeys.has(keyOf(channel.relationId, channel.channelId)),
  );
  const selectedCount = selectedChannels.length;
  const hasUnavailable = data.unavailableRelations.length > 0;
  const firstChannel = groups[0]?.channels[0];
  const summary =
    selectedCount === 0
      ? t('chat_integration.destination_select.summary_none')
      : t('chat_integration.destination_select.summary_selected', {
          selectedCount,
        });
  const accessibleName = [
    `${t('chat_integration.destination_select.aria_label')}: ${summary}`,
    hasUnavailable
      ? t('chat_integration.destination_select.partial_warning_title')
      : null,
  ]
    .filter((part) => part != null)
    .join('. ');

  return (
    <div data-testid="grw-chat-integration-save-time-destinations">
      <Dropdown
        isOpen={isOpen}
        toggle={() => setIsOpen((prev) => !prev)}
        direction={openInModal ? 'down' : 'up'}
        size="sm"
        // reactstrap's keyboard handling only knows `role="menuitem"` children;
        // with it on, Tab from the toggle moves focus nowhere. Focus moves into
        // the menu on open instead (see `focusOnMount`) and Tab walks the boxes.
        a11y={false}
      >
        <DropdownToggle
          color="outline-secondary"
          caret
          className="w-100 text-truncate d-flex justify-content-between align-items-center"
          innerRef={toggleRef}
          aria-label={accessibleName}
          title={
            selectedChannels
              .map(
                (channel) =>
                  `${channel.workspaceName} / #${channel.channelName}`,
              )
              .join('\n') || undefined
          }
        >
          <span className="text-truncate">{summary}</span>
          {hasUnavailable && (
            <span
              className="material-symbols-outlined text-warning ms-1 fs-6"
              title={t(
                'chat_integration.destination_select.partial_warning_title',
              )}
            >
              warning
            </span>
          )}
        </DropdownToggle>
        <DropdownMenu
          container={openInModal ? '' : 'body'}
          // The content is a list of checkboxes, not menu items.
          role="dialog"
          aria-label={t('chat_integration.destination_select.aria_label')}
        >
          {/* Closed, reactstrap still renders the menu in place (hidden by CSS); skip its content then so the bar stays small however many channels exist. */}
          {isOpen && (
            // biome-ignore lint/a11y/noStaticElementInteractions: closes the menu on Escape, which reactstrap does not do for focus inside the menu
            <div
              // In the modal the menu opens downward from the middle of the screen, so it gets less room than the bottom bar's upward menu.
              style={{
                maxHeight: openInModal ? '30vh' : '50vh',
                overflowY: 'auto',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsOpen(false);
                  toggleRef.current?.focus();
                  return;
                }
                if (e.key !== 'Tab') {
                  return;
                }
                // Out of the last / back past the first box, focus returns to
                // the toggle: the bottom bar's menu is portaled to <body>, so
                // the natural tab order would land somewhere unrelated.
                const boxes = e.currentTarget.querySelectorAll('input');
                const leaving = e.shiftKey
                  ? e.target === boxes[0]
                  : e.target === boxes[boxes.length - 1];
                if (leaving) {
                  e.preventDefault();
                  setIsOpen(false);
                  toggleRef.current?.focus();
                }
              }}
            >
              {groups.map((group) => {
                const headingId = `${idPrefix}-${group.relationId}`;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a fieldset would add default borders inside a dropdown menu
                  <div
                    key={group.relationId}
                    role="group"
                    aria-labelledby={headingId}
                  >
                    <h6 id={headingId} className="dropdown-header">
                      {group.workspaceName}
                    </h6>
                    {group.channels.map((channel) => {
                      const checkboxId = `${idPrefix}-${keyOf(channel.relationId, channel.channelId).replace(/\s/g, '-')}`;
                      return (
                        <div key={checkboxId} className="form-check mx-3 mb-1">
                          <input
                            id={checkboxId}
                            type="checkbox"
                            className="form-check-input"
                            ref={
                              channel === firstChannel
                                ? focusOnMount
                                : undefined
                            }
                            checked={selectedKeys.has(
                              keyOf(channel.relationId, channel.channelId),
                            )}
                            onChange={(e) =>
                              handleToggleChannel(channel, e.target.checked)
                            }
                          />
                          <label
                            className="form-check-label text-nowrap"
                            htmlFor={checkboxId}
                          >
                            #{channel.channelName}
                            {channel.isPrivate && (
                              <span className="text-muted ms-1">
                                {t(
                                  'chat_integration.destination_select.private',
                                )}
                              </span>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {hasUnavailable && (
                <div className="border-top mt-2 pt-2 px-3 text-warning small">
                  {data.unavailableRelations.map((relation) => (
                    <p key={relation.relationId} className="mb-1">
                      <span className="material-symbols-outlined fs-6 align-middle me-1">
                        warning
                      </span>
                      {t(
                        'chat_integration.destination_select.partial_warning_detail',
                        {
                          workspace: relation.workspaceName,
                          reason: relation.reason,
                        },
                      )}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </DropdownMenu>
      </Dropdown>
    </div>
  );
};

ChatIntegrationDestinationSelect.displayName =
  'ChatIntegrationDestinationSelect';
