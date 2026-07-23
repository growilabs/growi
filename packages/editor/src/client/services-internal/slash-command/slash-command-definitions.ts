import {
  codeBlockInsertion,
  lineMarkerInsertion,
  tableInsertion,
} from './insertion-builders.js';
import type { SlashCommand } from './slash-command-types.js';

/**
 * Single source of truth for the MVP slash command set (Req 5.1).
 *
 * Consumers (`resolveSlashCommands`, the completion source) receive this set as
 * input rather than hardcoding it, so adding or removing a command is a one-file
 * change here.
 *
 * Every command is an `insert` action wired to a pure builder from
 * `insertion-builders`; the `run` variant is reserved for extended elements
 * (drawio/math/lsx/template), which are intentionally excluded from this
 * release (Req 5.4).
 *
 * i18n keys follow `slash_command.<id>.(label|description)`; the display strings
 * are attached later by `resolveSlashCommands(t)`.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'heading1',
    labelKey: 'slash_command.heading1.label',
    descriptionKey: 'slash_command.heading1.description',
    keywords: ['h1', 'title'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('# ') },
  },
  {
    id: 'heading2',
    labelKey: 'slash_command.heading2.label',
    descriptionKey: 'slash_command.heading2.description',
    keywords: ['h2', 'subtitle'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('## ') },
  },
  {
    id: 'heading3',
    labelKey: 'slash_command.heading3.label',
    descriptionKey: 'slash_command.heading3.description',
    keywords: ['h3'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('### ') },
  },
  {
    id: 'bulletList',
    labelKey: 'slash_command.bulletList.label',
    descriptionKey: 'slash_command.bulletList.description',
    keywords: ['ul', 'unordered', 'bullet', 'list'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('- ') },
  },
  {
    id: 'numberedList',
    labelKey: 'slash_command.numberedList.label',
    descriptionKey: 'slash_command.numberedList.description',
    keywords: ['ol', 'ordered', 'number', 'list'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('1. ') },
  },
  {
    id: 'taskList',
    labelKey: 'slash_command.taskList.label',
    descriptionKey: 'slash_command.taskList.description',
    keywords: ['todo', 'checkbox', 'check', 'list'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('- [ ] ') },
  },
  {
    id: 'quote',
    labelKey: 'slash_command.quote.label',
    descriptionKey: 'slash_command.quote.description',
    keywords: ['blockquote', 'citation'],
    action: { kind: 'insert', buildInsertion: lineMarkerInsertion('> ') },
  },
  {
    id: 'codeBlock',
    labelKey: 'slash_command.codeBlock.label',
    descriptionKey: 'slash_command.codeBlock.description',
    keywords: ['code', 'fence', 'pre'],
    action: { kind: 'insert', buildInsertion: codeBlockInsertion },
  },
  {
    id: 'table',
    labelKey: 'slash_command.table.label',
    descriptionKey: 'slash_command.table.description',
    keywords: ['grid'],
    action: { kind: 'insert', buildInsertion: tableInsertion },
  },
];
