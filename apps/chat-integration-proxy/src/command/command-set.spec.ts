import { COMMAND_NAMES } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_TRAITS,
  LINK_COMMAND_WORD,
  LINK_TRAIT,
  SEARCH_DEFAULT_LIMIT,
} from './command-set.js';

// design.md's CommandSet table lists exactly the 5 `CommandName`-vocabulary
// commands plus `link` as a genuinely separate word. The completeness check
// below derives the vocabulary list from `COMMAND_NAMES`'s own values, not
// a hardcoded count, so it automatically stays in sync if `@growi/chat`'s
// vocabulary ever changes (task 1.6's capability-table completeness test
// establishes this same convention for this app).
describe('COMMAND_TRAITS completeness', () => {
  it('has a declared trait for every CommandName vocabulary value', () => {
    const commandNames = Object.values(COMMAND_NAMES);
    expect(commandNames.length).toBeGreaterThan(0);

    for (const name of commandNames) {
      const trait = COMMAND_TRAITS[name];
      expect(trait).toBeDefined();
      expect(trait.fields).toBeDefined();
      expect(trait.sends).toBeDefined();
      expect(trait.targeting).toBeDefined();
      expect(trait.permissionCheckName).toBe(name);
    }
  });
});

describe("link -- outside @growi/chat's shared vocabulary", () => {
  it('is not one of the CommandName values', () => {
    const commandNames: readonly string[] = Object.values(COMMAND_NAMES);
    expect(commandNames).not.toContain(LINK_COMMAND_WORD);
  });

  it('has a genuinely null permission-check name, not a string', () => {
    expect(LINK_TRAIT.permissionCheckName).toBeNull();
  });

  it('sends AccountLinkStartRequest, not CommandRequest', () => {
    expect(LINK_TRAIT.sends).toBe('account-link-start');
  });

  it('targets every paired GROWI with no permission filter', () => {
    expect(LINK_TRAIT.targeting).toBe('all-paired-no-filter');
  });

  it('collects no fields', () => {
    expect(LINK_TRAIT.fields).toEqual([]);
  });
});

describe('search', () => {
  it('declares the proxy-decided default limit as 10', () => {
    expect(SEARCH_DEFAULT_LIMIT).toBe(10);
  });

  it('collects only a required free-text keyword', () => {
    const trait = COMMAND_TRAITS[COMMAND_NAMES.search];
    expect(trait.fields).toEqual([
      { name: 'keyword', label: 'Keyword', required: true, kind: 'text' },
    ]);
    expect(trait.targeting).toBe('all-permitted');
  });
});

describe('create-page / keep -- title is deliberately not collected', () => {
  it('create-page has no title field', () => {
    const trait = COMMAND_TRAITS[COMMAND_NAMES.createPage];
    expect(trait.fields.some((field) => field.name === 'title')).toBe(false);
    expect(trait.fields.map((field) => field.name)).toEqual(['path', 'body']);
    expect(trait.targeting).toBe('exactly-one');
  });

  it('keep has no title field', () => {
    const trait = COMMAND_TRAITS[COMMAND_NAMES.keep];
    expect(trait.fields.some((field) => field.name === 'title')).toBe(false);
    expect(trait.fields.map((field) => field.name)).toEqual(['range', 'path']);
    expect(trait.targeting).toBe('exactly-one');
  });
});

describe('help', () => {
  it('collects no fields and targets all permitted GROWIs', () => {
    const trait = COMMAND_TRAITS[COMMAND_NAMES.help];
    expect(trait.fields).toEqual([]);
    expect(trait.targeting).toBe('all-permitted');
  });
});

describe('link-preview', () => {
  it('is url-matched and collects no fields', () => {
    const trait = COMMAND_TRAITS[COMMAND_NAMES.linkPreview];
    expect(trait.fields).toEqual([]);
    expect(trait.targeting).toBe('url-match');
  });
});
