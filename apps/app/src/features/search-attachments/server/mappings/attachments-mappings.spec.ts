import { describe, expect, it } from 'vitest';

import { mappings as mappingsEs7 } from './attachments-mappings-es7';
import { mappings as mappingsEs8 } from './attachments-mappings-es8';
import { mappings as mappingsEs9 } from './attachments-mappings-es9';

// Fields that must NEVER appear in attachment mappings (Option D structural guarantee)
const FORBIDDEN_PERMISSION_FIELDS = [
  'grant',
  'granted_users',
  'granted_groups',
  'creator',
];

// Required attachment fields
const REQUIRED_FIELDS = [
  'attachmentId',
  'pageId',
  'pageNumber',
  'label',
  'fileName',
  'originalName',
  'fileFormat',
  'fileSize',
  'attachmentType',
  'created_at',
  'updated_at',
  'content',
];

describe.each([
  { name: 'ES7', mappings: mappingsEs7 },
  { name: 'ES8', mappings: mappingsEs8 },
  { name: 'ES9', mappings: mappingsEs9 },
])('attachments mappings ($name)', ({ name: _name, mappings }) => {
  it('has a settings block with analysis configuration', () => {
    expect(mappings.settings).toBeDefined();
    expect(mappings.settings?.analysis).toBeDefined();
    expect(mappings.settings?.analysis?.analyzer).toBeDefined();
  });

  it('has a mappings block with properties', () => {
    expect(mappings.mappings).toBeDefined();
    expect(mappings.mappings?.properties).toBeDefined();
  });

  it('contains all required fields', () => {
    const properties = mappings.mappings?.properties as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      expect(
        properties,
        `Expected field "${field}" to be present`,
      ).toHaveProperty(field);
    }
  });

  it('does NOT contain any permission fields (Option D guarantee)', () => {
    const properties = mappings.mappings?.properties as Record<string, unknown>;
    const presentKeys = Object.keys(properties);
    for (const forbidden of FORBIDDEN_PERMISSION_FIELDS) {
      expect(
        presentKeys,
        `Permission field "${forbidden}" must not exist in attachment mappings`,
      ).not.toContain(forbidden);
    }
  });

  it('grant is not present', () => {
    const properties = mappings.mappings?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).not.toContain('grant');
  });

  it('granted_users is not present', () => {
    const properties = mappings.mappings?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).not.toContain('granted_users');
  });

  it('granted_groups is not present', () => {
    const properties = mappings.mappings?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).not.toContain('granted_groups');
  });

  it('creator is not present', () => {
    const properties = mappings.mappings?.properties as Record<string, unknown>;
    expect(Object.keys(properties)).not.toContain('creator');
  });

  it('attachmentId is keyword type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.attachmentId?.type).toBe('keyword');
  });

  it('pageId is keyword type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.pageId?.type).toBe('keyword');
  });

  it('pageNumber is integer type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.pageNumber?.type).toBe('integer');
  });

  it('fileSize is long type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.fileSize?.type).toBe('long');
  });

  it('fileFormat is keyword type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.fileFormat?.type).toBe('keyword');
  });

  it('attachmentType is keyword type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.attachmentType?.type).toBe('keyword');
  });

  it('created_at is date type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.created_at?.type).toBe('date');
  });

  it('updated_at is date type', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string }
    >;
    expect(properties.updated_at?.type).toBe('date');
  });

  it('fileName has text type with keyword sub-field', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string; fields?: Record<string, { type: string }> }
    >;
    expect(properties.fileName?.type).toBe('text');
    expect(properties.fileName?.fields?.keyword?.type).toBe('keyword');
  });

  it('originalName has text type with keyword sub-field', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      { type: string; fields?: Record<string, { type: string }> }
    >;
    expect(properties.originalName?.type).toBe('text');
    expect(properties.originalName?.fields?.keyword?.type).toBe('keyword');
  });

  it('content has text type with ja and en multi-fields', () => {
    const properties = mappings.mappings?.properties as Record<
      string,
      {
        type: string;
        fields?: Record<
          string,
          { type: string; analyzer?: string; search_analyzer?: string }
        >;
      }
    >;
    expect(properties.content?.type).toBe('text');
    expect(properties.content?.fields?.ja?.analyzer).toBe('japanese');
    expect(properties.content?.fields?.en?.analyzer).toBe('english_edge_ngram');
    expect(properties.content?.fields?.en?.search_analyzer).toBe('standard');
  });

  it('matches snapshot', () => {
    expect(mappings).toMatchSnapshot();
  });
});
