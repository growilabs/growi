// Task 9.3's half of the admin screen: which channels this relation posts
// page notifications to (Requirement 2.2), and the warning about a channel
// that Gen 1 also posts to (Requirement 12.4).
//
// Two things are deliberate here:
//
//   - The channel is PICKED FROM A LIST, never typed. The list comes from
//     the proxy (`ChannelInventory`) and each option carries the channel's
//     IDENTIFIER as its value, so what gets saved is the identifier even
//     though what the administrator reads is the name. There is no
//     free-text channel field, and no name is sent to the server -- the
//     server takes the name from the same list it just fetched.
//   - The screen reads BOTH the list and the warnings from ONE endpoint.
//     The server refreshes the stored channel names from the very fetch
//     that answers this call, so the warnings can never be computed from a
//     name the chat service has already changed (see
//     `server/admin/notification-destinations.ts`).
//
// Follows this feature's client convention (see `AdminChatIntegration.tsx`):
// plain hooks + `~/client/util/apiv3-client`, English-first UI text.

import { type JSX, useCallback, useId, useState } from 'react';
import useSWR from 'swr';

import { TriggerEventType } from '~/client/interfaces/global-notification';
import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';

interface AdminChannel {
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
}

interface AdminNotificationDestination {
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly pathPattern: string;
  readonly triggerEvents: readonly string[];
}

interface NotificationDestinationsView {
  readonly destinations: readonly AdminNotificationDestination[];
  readonly channels: readonly AdminChannel[];
  readonly channelsUnavailable: string | null;
  readonly overlaps: ReadonlyArray<{
    readonly channelId: string;
    readonly channelName: string;
  }>;
  readonly overlapsMayBeStale: boolean;
}

/**
 * The events a destination can subscribe to. Reuses the vocabulary the
 * existing notification screens already show, rather than restating the
 * event names here.
 */
const TRIGGER_EVENTS: ReadonlyArray<string> = Object.values(TriggerEventType);

const DEFAULT_PATH_PATTERN = '/*';

const endpointFor = (relationId: string): string =>
  `/chat-integration/admin/relations/${relationId}/notification-destinations`;

const fetchDestinationsFor = (
  relationId: string,
): (() => Promise<NotificationDestinationsView>) => {
  return async () => {
    const res = await apiv3Get<NotificationDestinationsView>(
      endpointFor(relationId),
    );
    return res.data;
  };
};

/**
 * What an administrator reads for one option. The identifier is shown
 * alongside the name because the name is only a label here -- two channels
 * can be renamed into looking alike, and the identifier is what gets saved.
 */
const describeChannel = (channel: AdminChannel): string =>
  `#${channel.channelName} (${channel.channelId})${channel.isPrivate ? ' - private' : ''}`;

export const NotificationDestinationsSection = ({
  relationId,
}: {
  relationId: string;
}): JSX.Element => {
  const { data, error, mutate } = useSWR<NotificationDestinationsView>(
    `chat-integration-admin-destinations-${relationId}`,
    fetchDestinationsFor(relationId),
  );

  const [channelId, setChannelId] = useState('');
  const [pathPattern, setPathPattern] = useState(DEFAULT_PATH_PATTERN);
  const [triggerEvents, setTriggerEvents] = useState<readonly string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Safe with `id=`/`htmlFor=` (getElementById does not parse useId()'s
  // colons as CSS) -- see apps/app/.claude/rules/ui-pitfalls.md.
  const channelSelectId = useId();
  const pathPatternId = useId();

  const handleChannelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setChannelId(e.target.value);
    },
    [],
  );

  const handlePathPatternChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPathPattern(e.target.value);
    },
    [],
  );

  const handleTriggerEventToggle = useCallback(
    (event: string) => () => {
      setTriggerEvents((prev) =>
        prev.includes(event)
          ? prev.filter((each) => each !== event)
          : [...prev, event],
      );
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSaving(true);
      try {
        // Only the identifier of the chosen channel is sent: the server
        // resolves its name from the channel list itself.
        await apiv3Post(endpointFor(relationId), {
          channelId,
          pathPattern,
          triggerEvents: [...triggerEvents],
        });
        toastSuccess('Notification destination saved.');
        setChannelId('');
        setPathPattern(DEFAULT_PATH_PATTERN);
        setTriggerEvents([]);
        mutate();
      } catch (err) {
        toastError(err);
      } finally {
        setIsSaving(false);
      }
    },
    [channelId, mutate, pathPattern, relationId, triggerEvents],
  );

  return (
    <div className="mt-3">
      <span className="fw-bold">Notification destinations:</span>

      {error != null && (
        <p className="text-danger mb-0">
          Failed to load notification destinations
        </p>
      )}

      {data != null && data.overlaps.length > 0 && (
        <div
          className="alert alert-warning mt-2 mb-2"
          role="alert"
          data-testid="grw-chat-integration-destination-overlap-warning"
        >
          These channels are a destination for the existing (Gen 1) Slack
          notification as well, so a page event is posted to them twice:{' '}
          {data.overlaps.map((overlap) => overlap.channelName).join(', ')}. The
          match is by channel name, so a channel of the same name in another
          workspace is reported here too.
        </div>
      )}

      {/*
        Rendered right next to the overlap warning on purpose: without it,
        an empty warning area in this state reads as "checked, nothing
        overlaps", when in fact nothing was checked against the names the
        chat service reports now.
      */}
      {data?.overlapsMayBeStale === true && (
        <div
          className="alert alert-warning mt-2 mb-2"
          role="alert"
          data-testid="grw-chat-integration-destination-overlap-stale"
        >
          The channel names could not be refreshed from the chat service, so the
          double-posting check above may be stale — a channel that both
          generations post to may be missing from it.
        </div>
      )}

      {data != null && data.destinations.length === 0 && (
        <p className="text-muted mb-2">No destination has been added yet.</p>
      )}

      {data != null && data.destinations.length > 0 && (
        <table className="table table-sm table-bordered">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Channel id</th>
              <th>Page path</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {data.destinations.map((destination) => (
              <tr
                key={`${destination.channelId}-${destination.pathPattern}`}
                data-testid="grw-chat-integration-destination-row"
              >
                <td>{destination.channelName}</td>
                <td>{destination.channelId}</td>
                <td>{destination.pathPattern}</td>
                <td>{destination.triggerEvents.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data?.channelsUnavailable != null && (
        <p className="text-danger mb-0">
          The channel list could not be fetched from the proxy (
          {data.channelsUnavailable}), so no destination can be added right now.
        </p>
      )}

      {data != null && data.channelsUnavailable == null && (
        <form
          onSubmit={handleSubmit}
          data-testid="grw-chat-integration-destination-form"
        >
          <div className="row align-items-end g-2">
            <div className="col-5">
              <label className="form-label mb-0" htmlFor={channelSelectId}>
                Channel
              </label>
              <select
                id={channelSelectId}
                className="form-select"
                value={channelId}
                onChange={handleChannelChange}
                required
              >
                <option value="">Select a channel…</option>
                {data.channels.map((channel) => (
                  <option key={channel.channelId} value={channel.channelId}>
                    {describeChannel(channel)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-4">
              <label className="form-label mb-0" htmlFor={pathPatternId}>
                Page path
              </label>
              <input
                id={pathPatternId}
                type="text"
                className="form-control"
                value={pathPattern}
                onChange={handlePathPatternChange}
                required
              />
            </div>
            <div className="col-3">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving || channelId === ''}
              >
                {isSaving ? 'Saving…' : 'Add destination'}
              </button>
            </div>
          </div>
          <div className="mt-2">
            {TRIGGER_EVENTS.map((event) => (
              <div className="form-check form-check-inline" key={event}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`${channelSelectId}-${event}`}
                  checked={triggerEvents.includes(event)}
                  onChange={handleTriggerEventToggle(event)}
                />
                <label
                  className="form-check-label"
                  htmlFor={`${channelSelectId}-${event}`}
                >
                  {event}
                </label>
              </div>
            ))}
          </div>
        </form>
      )}
    </div>
  );
};

NotificationDestinationsSection.displayName = 'NotificationDestinationsSection';
