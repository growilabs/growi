import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  collectGen1SlackChannelNames,
  type Gen1NotificationSettingSource,
  readGen1SlackChannelNames,
} from './gen1-slack-channel-names';

describe('collectGen1SlackChannelNames', () => {
  it("splits one row's comma-separated list into channel names", () => {
    expect(
      collectGen1SlackChannelNames([
        { isEnabled: true, slackChannels: 'general, dev ,announcements' },
      ]),
    ).toEqual(['general', 'dev', 'announcements']);
  });

  it('gathers the names of every row, reporting each channel once', () => {
    expect(
      collectGen1SlackChannelNames([
        { isEnabled: true, slackChannels: 'general' },
        { isEnabled: true, slackChannels: 'dev,general' },
      ]),
    ).toEqual(['general', 'dev']);
  });

  it('ignores a mail-type row, which has no channel at all', () => {
    expect(
      collectGen1SlackChannelNames([
        { isEnabled: true },
        { isEnabled: true, slackChannels: 'general' },
      ]),
    ).toEqual(['general']);
  });

  it('ignores a row that is turned off, because it posts nothing', () => {
    expect(
      collectGen1SlackChannelNames([
        { isEnabled: false, slackChannels: 'general' },
      ]),
    ).toEqual([]);
  });

  it('drops the empty entries a trailing comma leaves behind', () => {
    expect(
      collectGen1SlackChannelNames([
        { isEnabled: true, slackChannels: 'general,, ,' },
      ]),
    ).toEqual(['general']);
  });
});

describe('readGen1SlackChannelNames', () => {
  it("reads the names through the caller's source", async () => {
    const source = mock<Gen1NotificationSettingSource>({
      findAll: vi
        .fn()
        .mockResolvedValue([{ isEnabled: true, slackChannels: 'general,dev' }]),
    });

    await expect(readGen1SlackChannelNames(source)).resolves.toEqual([
      'general',
      'dev',
    ]);
  });

  it('reports no Gen 1 destination when Gen 1 is not registered at all', async () => {
    await expect(readGen1SlackChannelNames(undefined)).resolves.toEqual([]);
  });

  it('lets a failed read surface instead of answering "no overlap"', async () => {
    // Answering `[]` here would show the administrator a confident "no
    // channel is configured twice" that was never actually checked.
    const source = mock<Gen1NotificationSettingSource>({
      findAll: vi.fn().mockRejectedValue(new Error('database is down')),
    });

    await expect(readGen1SlackChannelNames(source)).rejects.toThrow(
      'database is down',
    );
  });
});
