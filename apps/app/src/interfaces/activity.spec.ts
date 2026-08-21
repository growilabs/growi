import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AttachmentRemoveSnapshot,
  AttachmentSnapshot,
  DefaultSnapshot,
  IActivity,
  ISnapshot,
} from './activity';
import {
  AllSupportedActions,
  isAttachmentAddActivity,
  isAttachmentDownloadActivity,
  isAttachmentRemoveActivity,
  isAuditlogSuggestionField,
  MODEL_ATTACHMENT,
  SupportedAction,
  SupportedTargetModel,
} from './activity';

describe('isAuditlogSuggestionField()', () => {
  it('should return true for "username"', () => {
    expect(isAuditlogSuggestionField('username')).toBe(true);
  });

  it('should return false for an unrecognized string', () => {
    expect(isAuditlogSuggestionField('foo')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isAuditlogSuggestionField('')).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAuditlogSuggestionField(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAuditlogSuggestionField(undefined)).toBe(false);
  });
});

describe('SupportedAction - GROWI Vault resilience constants', () => {
  it('exports ACTION_VAULT_RESILIENCE_BOOTSTRAP_STARTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_BOOTSTRAP_STARTED).toBe(
      'vault.resilience.bootstrap-started',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_BOOTSTRAP_COMPLETED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_BOOTSTRAP_COMPLETED).toBe(
      'vault.resilience.bootstrap-completed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_BOOTSTRAP_FAILED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_BOOTSTRAP_FAILED).toBe(
      'vault.resilience.bootstrap-failed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_COMPLETENESS_CHECK_FAILED', () => {
    expect(
      SupportedAction.ACTION_VAULT_RESILIENCE_COMPLETENESS_CHECK_FAILED,
    ).toBe('vault.resilience.completeness-check-failed');
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_SCHEDULED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_SCHEDULED).toBe(
      'vault.resilience.retry-scheduled',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_FAILED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_FAILED).toBe(
      'vault.resilience.retry-failed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_ESCALATED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_ESCALATED).toBe(
      'vault.resilience.retry-escalated',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_RETRY_ABORTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_RETRY_ABORTED).toBe(
      'vault.resilience.retry-aborted',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_FORCE_WARNING_ACTIVE', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_FORCE_WARNING_ACTIVE).toBe(
      'vault.resilience.force-warning-active',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_STALE_RUNNING_DETECTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_STALE_RUNNING_DETECTED).toBe(
      'vault.resilience.stale-running-detected',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_STARTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_STARTED).toBe(
      'vault.resilience.drift-sweep-started',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_DETECTED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_DETECTED).toBe(
      'vault.resilience.drift-detected',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_REPAIRED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_REPAIRED).toBe(
      'vault.resilience.drift-repaired',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_FAILED', () => {
    expect(SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_FAILED).toBe(
      'vault.resilience.drift-sweep-failed',
    );
  });

  it('exports ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_OUT_OF_SCOPE', () => {
    expect(
      SupportedAction.ACTION_VAULT_RESILIENCE_DRIFT_SWEEP_OUT_OF_SCOPE,
    ).toBe('vault.resilience.drift-sweep-out-of-scope');
  });

  it('all 15 resilience constants are present in SupportedAction', () => {
    const keys = Object.keys(SupportedAction);
    const resilienceKeys = keys.filter((k) =>
      k.startsWith('ACTION_VAULT_RESILIENCE_'),
    );
    expect(resilienceKeys).toHaveLength(15);
  });
});

describe('SupportedAction - admin AI setting update action', () => {
  it('exports ACTION_ADMIN_AI_SETTING_UPDATE with the expected value', () => {
    expect(SupportedAction.ACTION_ADMIN_AI_SETTING_UPDATE).toBe(
      'ADMIN_AI_SETTING_UPDATE',
    );
  });

  it('includes the AI setting update action in AllSupportedActions', () => {
    expect(AllSupportedActions).toContain('ADMIN_AI_SETTING_UPDATE');
  });
});

describe('SupportedTargetModel', () => {
  it('includes Attachment while preserving the existing four models', () => {
    expect(SupportedTargetModel).toEqual({
      MODEL_PAGE: 'Page',
      MODEL_USER: 'User',
      MODEL_PAGE_BULK_EXPORT_JOB: 'PageBulkExportJob',
      MODEL_AUDIT_LOG_BULK_EXPORT_JOB: 'AuditLogBulkExportJob',
      MODEL_ATTACHMENT: 'Attachment',
    });
  });

  it('exports MODEL_ATTACHMENT as the Attachment model literal', () => {
    expect(MODEL_ATTACHMENT).toBe('Attachment');
  });
});

describe('isAttachmentRemoveActivity', () => {
  it('narrows an ATTACHMENT_REMOVE activity so attachment fields are readable', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      snapshot: {
        username: 'alice',
        originalName: 'diagram.png',
        pagePath: '/Sandbox',
        pageId: '65a000000000000000000001',
        fileSize: 4096,
      },
    };

    if (isAttachmentRemoveActivity(activity)) {
      // Compile-time proof: attachment-specific fields are accessible after narrowing
      expectTypeOf(activity.snapshot?.originalName).toEqualTypeOf<
        string | undefined
      >();
      expectTypeOf(activity.snapshot?.fileSize).toEqualTypeOf<
        number | undefined
      >();

      expect(activity.snapshot?.username).toBe('alice');
      expect(activity.snapshot?.originalName).toBe('diagram.png');
      expect(activity.snapshot?.pagePath).toBe('/Sandbox');
      expect(activity.snapshot?.pageId).toBe('65a000000000000000000001');
      expect(activity.snapshot?.fileSize).toBe(4096);
    } else {
      expect.unreachable('guard must accept ACTION_ATTACHMENT_REMOVE');
    }
  });

  it('accepts an ATTACHMENT_REMOVE activity without snapshot (action is the sole discriminant)', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
    };

    expect(isAttachmentRemoveActivity(activity)).toBe(true);
  });

  it('rejects the neighboring ATTACHMENT_ADD action', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_ADD,
      snapshot: { username: 'alice' },
    };

    expect(isAttachmentRemoveActivity(activity)).toBe(false);
  });

  it('rejects other actions even when the snapshot carries attachment-shaped fields', () => {
    // The union is not correlated with action at construction time,
    // so this object is representable; the guard must still say no.
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      snapshot: { username: 'alice', originalName: 'stale.png' },
    };

    expect(isAttachmentRemoveActivity(activity)).toBe(false);
  });
});

describe('isAttachmentAddActivity', () => {
  it('narrows an ATTACHMENT_ADD activity so attachment fields are readable', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_ADD,
      snapshot: {
        username: 'alice',
        originalName: 'diagram.png',
        pagePath: '/Sandbox',
        pageId: '65a000000000000000000001',
        fileSize: 4096,
      },
    };

    if (isAttachmentAddActivity(activity)) {
      // Compile-time proof: attachment-specific fields are accessible after narrowing
      expectTypeOf(activity.snapshot?.originalName).toEqualTypeOf<
        string | undefined
      >();
      expectTypeOf(activity.snapshot?.fileSize).toEqualTypeOf<
        number | undefined
      >();

      expect(activity.snapshot?.username).toBe('alice');
      expect(activity.snapshot?.originalName).toBe('diagram.png');
      expect(activity.snapshot?.pagePath).toBe('/Sandbox');
      expect(activity.snapshot?.pageId).toBe('65a000000000000000000001');
      expect(activity.snapshot?.fileSize).toBe(4096);
    } else {
      expect.unreachable('guard must accept ACTION_ATTACHMENT_ADD');
    }
  });

  it('accepts a legacy username-only snapshot recorded before this increment', () => {
    // Pre-increment ADD records carry the catch-all { username? } shape;
    // they must pass through the guard without a type error (req 5.4).
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_ADD,
      snapshot: { username: 'alice' },
    };

    if (isAttachmentAddActivity(activity)) {
      expect(activity.snapshot?.username).toBe('alice');
      expect(activity.snapshot?.originalName).toBeUndefined();
    } else {
      expect.unreachable('guard must accept a legacy username-only snapshot');
    }
  });

  it('accepts an ATTACHMENT_ADD activity without snapshot (action is the sole discriminant)', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_ADD,
    };

    expect(isAttachmentAddActivity(activity)).toBe(true);
  });

  it('rejects the sibling attachment actions (REMOVE / DOWNLOAD)', () => {
    const remove: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      snapshot: { username: 'alice' },
    };
    const download: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
      snapshot: { username: 'alice' },
    };

    expect(isAttachmentAddActivity(remove)).toBe(false);
    expect(isAttachmentAddActivity(download)).toBe(false);
  });

  it('rejects non-attachment actions even when the snapshot carries attachment-shaped fields', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      snapshot: { username: 'alice', originalName: 'stale.png' },
    };

    expect(isAttachmentAddActivity(activity)).toBe(false);
  });
});

describe('isAttachmentDownloadActivity', () => {
  it('narrows an ATTACHMENT_DOWNLOAD activity so attachment fields are readable', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
      snapshot: {
        username: 'alice',
        originalName: 'report.pdf',
        pagePath: '/Reports',
        pageId: '65a000000000000000000003',
        fileSize: 8192,
      },
    };

    if (isAttachmentDownloadActivity(activity)) {
      // Compile-time proof: attachment-specific fields are accessible after narrowing
      expectTypeOf(activity.snapshot?.originalName).toEqualTypeOf<
        string | undefined
      >();
      expectTypeOf(activity.snapshot?.fileSize).toEqualTypeOf<
        number | undefined
      >();

      expect(activity.snapshot?.username).toBe('alice');
      expect(activity.snapshot?.originalName).toBe('report.pdf');
      expect(activity.snapshot?.pagePath).toBe('/Reports');
      expect(activity.snapshot?.pageId).toBe('65a000000000000000000003');
      expect(activity.snapshot?.fileSize).toBe(8192);
    } else {
      expect.unreachable('guard must accept ACTION_ATTACHMENT_DOWNLOAD');
    }
  });

  it('accepts a guest download whose snapshot omits username (all fields optional)', () => {
    // Guest (anonymous) downloads have no req.user, so username may be absent (req 5.3).
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
      snapshot: { originalName: 'report.pdf', fileSize: 8192 },
    };

    if (isAttachmentDownloadActivity(activity)) {
      expect(activity.snapshot?.username).toBeUndefined();
      expect(activity.snapshot?.originalName).toBe('report.pdf');
    } else {
      expect.unreachable('guard must accept a username-less snapshot');
    }
  });

  it('accepts an ATTACHMENT_DOWNLOAD activity without snapshot (action is the sole discriminant)', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    };

    expect(isAttachmentDownloadActivity(activity)).toBe(true);
  });

  it('rejects the sibling attachment actions (ADD / REMOVE)', () => {
    const add: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_ADD,
      snapshot: { username: 'alice' },
    };
    const remove: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
      snapshot: { username: 'alice' },
    };

    expect(isAttachmentDownloadActivity(add)).toBe(false);
    expect(isAttachmentDownloadActivity(remove)).toBe(false);
  });

  it('rejects non-attachment actions even when the snapshot carries attachment-shaped fields', () => {
    const activity: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      snapshot: { username: 'alice', originalName: 'stale.png' },
    };

    expect(isAttachmentDownloadActivity(activity)).toBe(false);
  });
});

describe('attachment guards coexistence', () => {
  it('matches each attachment action with exactly its own guard', () => {
    const add: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_ADD,
    };
    const remove: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
    };
    const download: Pick<IActivity, 'action' | 'snapshot'> = {
      action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    };

    expect(isAttachmentAddActivity(add)).toBe(true);
    expect(isAttachmentRemoveActivity(add)).toBe(false);
    expect(isAttachmentDownloadActivity(add)).toBe(false);

    expect(isAttachmentAddActivity(remove)).toBe(false);
    expect(isAttachmentRemoveActivity(remove)).toBe(true);
    expect(isAttachmentDownloadActivity(remove)).toBe(false);

    expect(isAttachmentAddActivity(download)).toBe(false);
    expect(isAttachmentRemoveActivity(download)).toBe(false);
    expect(isAttachmentDownloadActivity(download)).toBe(true);
  });
});

describe('AttachmentSnapshot canonical type', () => {
  it('keeps AttachmentRemoveSnapshot as an alias of the canonical type (backward compat)', () => {
    expectTypeOf<AttachmentRemoveSnapshot>().toEqualTypeOf<AttachmentSnapshot>();
  });

  it('keeps every field optional so partial capture stays representable (graceful degradation)', () => {
    expectTypeOf<AttachmentSnapshot>().toEqualTypeOf<{
      username?: string;
      originalName?: string;
      pagePath?: string;
      pageId?: string;
      fileSize?: number;
    }>();

    // An entirely empty snapshot is a valid value of the canonical type
    const empty: AttachmentSnapshot = {};
    expect(empty).toEqual({});
  });

  it('remains a member of the ISnapshot union without extra fields', () => {
    const snapshot: AttachmentSnapshot = {
      originalName: 'photo.jpg',
      fileSize: 123,
    };
    const asUnion: ISnapshot = snapshot;

    expect(asUnion).toBe(snapshot);
  });
});

describe('ISnapshot union', () => {
  it('keeps username readable on both variants without narrowing (backward compat)', () => {
    const defaultSnapshot: ISnapshot = { username: 'alice' };
    const attachmentSnapshot: ISnapshot = {
      username: 'bob',
      originalName: 'photo.jpg',
      pagePath: '/album',
      pageId: '65a000000000000000000002',
      fileSize: 123,
    };

    // Reading `.username` on the unnarrowed union must compile for both variants
    expect(defaultSnapshot.username).toBe('alice');
    expect(attachmentSnapshot.username).toBe('bob');
  });

  it('treats the catch-all variant as the existing { username?: string } shape', () => {
    expectTypeOf<DefaultSnapshot>().toEqualTypeOf<{ username?: string }>();
  });

  it('does not expose attachment-specific fields on the unnarrowed union', () => {
    expectTypeOf<ISnapshot>().not.toHaveProperty('originalName');
    expectTypeOf<ISnapshot>().not.toHaveProperty('pagePath');
    expectTypeOf<ISnapshot>().not.toHaveProperty('pageId');
    expectTypeOf<ISnapshot>().not.toHaveProperty('fileSize');
  });

  it('types fileSize as a number on the attachment variant', () => {
    expectTypeOf<AttachmentRemoveSnapshot['fileSize']>().toEqualTypeOf<
      number | undefined
    >();
  });
});
