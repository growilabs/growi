// The three endpoints a GROWI reads from: what each chat service can do
// (`capabilities`), whether the connection serving its workspace is up
// (`connection-status`), and which channels it may aim a notification at
// (`channels`). design.md's 「GROWI から届く口」 table; Requirements 1.3, 1.4,
// 2.2, 11.1.
//
// **What this file owns is design.md's 「返す範囲」 column**, and it is the
// only thing here that is not wiring. The column exists because the shortest
// implementation of a read endpoint returns whatever the internal state holds,
// and an official proxy carries many GROWIs: a caller that can produce a valid
// signature is a paired GROWI, not a trusted one, and must never learn what
// another tenant has. So:
//
//  - **`capabilities` is proxy-wide.** The table is static and identical for
//    every workspace, so there is no scope to keep; the report is built by
//    `buildCapabilityReport()` (`capabilities/`), which takes no relation at
//    all.
//  - **`connection-status` answers for one service, for connections that serve
//    THIS installation.** Two narrowings, and both are needed. Answering every
//    configured service would tell one tenant about services it has no
//    installation on; answering every connection of its own service would, for
//    a per-installation service such as Mattermost, fold another tenant's
//    failing connection into this one's health -- design.md's worst-of rule is
//    over the connections of one caller, not of one proxy. **The count of
//    installations a connection serves is never returned**: on an official
//    proxy that number is how many companies share it, shown to all of them.
//    That is structural rather than remembered -- `ConnectionStatusView`
//    (`@growi/chat`) has no field for it, and `toConnectionStatusViews` is what
//    maps the internal row (which does carry the ids) into it.
//  - **`channels` answers one installation's saved inventory.** The read is by
//    installation id (`listByInstallation`), so no other tenant's rows are
//    fetched at all, rather than fetched and filtered.
//
// **The installation is resolved from the key the signature proved**, never
// from the body. The guard's `acceptEnvelope()` has already established that
// the two agree, so both routes would reach the same relation either way; the
// point is that the scoping does not DEPEND on a check made in another file.
//
// The saved inventory is read from storage rather than asked of the chat
// service per request, for the reason design.md gives for the notification
// destination check: a caller that could make this proxy call out once per
// request could drive it into the service's rate limit. `ChannelDirectory`
// refreshes the inventory on this proxy's own schedule.
import type {
  ChannelInventory,
  ConnectionStatusView,
  PlatformName,
} from '@growi/chat';
import { OP_NAMES, parseOpEnvelope } from '@growi/chat';
import type { Hono } from 'hono';

import type { ConnectionUnit } from '../capabilities/index.js';
import { buildCapabilityReport } from '../capabilities/index.js';
import type {
  InstallationChannelRepository,
  InstallationRepository,
  RelationRepository,
} from '../db/index.js';
import type { ConnectionManager } from '../platform/index.js';
import { toConnectionStatusViews } from '../platform/index.js';
import type {
  SignatureGuardDeps,
  SignedRequestEnv,
} from './signature-guard.js';
import { pathForOp, signatureGuard } from './signature-guard.js';

export interface ReadRoutesDeps {
  readonly signature: SignatureGuardDeps;
  /** Resolves the verified relation into the installation it belongs to. */
  readonly relations: Pick<RelationRepository, 'findById'>;
  /** Resolves that installation into the service it is installed on. */
  readonly installations: Pick<InstallationRepository, 'findById'>;
  readonly channels: Pick<InstallationChannelRepository, 'listByInstallation'>;
  readonly connections: Pick<ConnectionManager, 'status'>;
  /**
   * `CONNECTION_UNIT_TABLE` (`capabilities/`). Taken as an argument rather
   * than imported, so this endpoint and the `ConnectionManager` whose rows it
   * maps are guaranteed to read the same table -- `ConnectionManagerDeps`
   * takes it the same way, and two independently-sourced tables could disagree
   * about which services hold a connection at all.
   */
  readonly units: Readonly<Record<PlatformName, ConnectionUnit>>;
  readonly now?: () => Date;
}

/**
 * The installation the verified relation belongs to, and the service it is on.
 *
 * Throws when either row is missing. That is unreachable by construction --
 * the guard resolved this relation's public key out of `peer_key`, which is
 * `Restrict`-bound to the relation, so a caller whose relation is gone is
 * already refused with a 401 -- and Hono's 500 is the right answer if it ever
 * happens: an empty inventory or an invented health would be a lie about a
 * proxy whose storage is inconsistent.
 */
const locateInstallation = async (
  deps: ReadRoutesDeps,
  relationId: string,
): Promise<{ installationId: string; platform: PlatformName }> => {
  const relation = await deps.relations.findById(relationId);
  if (relation == null) {
    throw new Error(`no relation ${relationId}`);
  }
  const installation = await deps.installations.findById(
    relation.installationId,
  );
  if (installation == null) {
    throw new Error(
      `relation ${relationId} names installation ${relation.installationId}, which does not exist`,
    );
  }
  // `InstallationRecord.platform` is a plain string (the column is not a
  // database enum, so the list of services has one declaration -- the
  // TypeScript union). Narrowing through the unit table rather than asserting
  // keeps a row written by some other means from reaching the mapping below.
  if (!(installation.platform in deps.units)) {
    throw new Error(
      `installation ${installation.installationId} names unknown service '${installation.platform}'`,
    );
  }
  return {
    installationId: installation.installationId,
    platform: installation.platform as PlatformName,
  };
};

export const registerReadRoutes = (
  app: Hono<SignedRequestEnv>,
  deps: ReadRoutesDeps,
): void => {
  const guard = signatureGuard(deps.signature);
  const now = deps.now ?? (() => new Date());

  /**
   * Every one of the three bodies is the envelope and nothing else, so all
   * three share `parseOpEnvelope` (the protocol's own `OpOnlyRequest`). It is
   * still run: which op a body claims was checked against the endpoint by the
   * guard, but the shape of the value has not been.
   *
   * Its allow-list is wider than these three ops (it also admits
   * `settings-pull`, which this proxy sends rather than serves) -- **the guard
   * is what pins a body to the endpoint it arrived at**, not this call. What
   * is added here is the field-level check, including the length bound on
   * `relationId`.
   */
  const refuseMalformedBody = (body: unknown): boolean =>
    'error' in parseOpEnvelope(body);

  app.post(pathForOp(OP_NAMES.capabilities), guard, (c) => {
    if (refuseMalformedBody(c.get('verifiedBody'))) {
      return c.body(null, 400);
    }
    return c.json(buildCapabilityReport());
  });

  app.post(pathForOp(OP_NAMES.connectionStatus), guard, async (c) => {
    if (refuseMalformedBody(c.get('verifiedBody'))) {
      return c.body(null, 400);
    }
    const { installationId, platform } = await locateInstallation(
      deps,
      c.get('verifiedKey').relationId,
    );

    const rows = await deps.connections.status();
    const fallbackSince = now();
    const views = toConnectionStatusViews(
      // Only the connections that serve this caller. A per-app service
      // (Slack, Discord) lists every installation it serves, so this keeps
      // its single row; a per-installation service (Mattermost) has one row
      // per installation, and this is what stops another tenant's failure
      // from being reported as this one's.
      rows.filter((row) => row.servedInstallationIds.includes(installationId)),
      [platform],
      deps.units,
      fallbackSince,
    );

    // `toConnectionStatusViews` reports nothing for a connection-bearing
    // service with no rows -- before the first reconciliation, and for an
    // installation whose connection has not been opened yet. The endpoint has
    // to answer something, and the least-invented value in the declared type
    // is `reconnecting`: `failed` would call out an operator over a proxy that
    // has simply not reconciled yet, and `not-applicable` would claim the
    // service needs no connection at all.
    const view: ConnectionStatusView = views[0] ?? {
      platform,
      health: 'reconnecting',
      since: fallbackSince.toISOString(),
    };
    return c.json(view);
  });

  app.post(pathForOp(OP_NAMES.channels), guard, async (c) => {
    if (refuseMalformedBody(c.get('verifiedBody'))) {
      return c.body(null, 400);
    }
    const { installationId } = await locateInstallation(
      deps,
      c.get('verifiedKey').relationId,
    );

    const rows = await deps.channels.listByInstallation(installationId);
    // `refreshedAt` and `installationId` are dropped: the wire type carries
    // neither, and the row's own `platform` is kept because one installation
    // is on exactly one service and the admin screen picks destinations by
    // `(platform, channelId)`.
    const inventory: ChannelInventory = {
      channels: rows.map((row) => ({
        platform: row.platform as PlatformName,
        channelId: row.channelId,
        channelName: row.channelName,
        isPrivate: row.isPrivate,
      })),
    };
    return c.json(inventory);
  });
};
