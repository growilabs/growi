import type { GetServerSidePropsContext } from 'next';
import superjson from 'superjson';
import { describe, expect, it } from 'vitest';

import { deserializeSuperJSONProps, withSuperJSONProps } from './superjson-ssr';

// Helper to create a minimal GetServerSidePropsContext
const createMockContext = (): GetServerSidePropsContext =>
  ({
    req: {} as never,
    res: {} as never,
    params: {},
    query: {},
    resolvedUrl: '/',
    locale: 'en',
  }) as GetServerSidePropsContext;

describe('withSuperJSONProps', () => {
  it('should serialize Date objects in props', async () => {
    const date = new Date('2026-01-15T00:00:00.000Z');
    const gssp = async () => ({
      props: { createdAt: date, name: 'test' },
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());

    expect(result).toHaveProperty('props');
    const props = (result as { props: Record<string, unknown> }).props;

    // Date should be serialized as ISO string
    expect(props.createdAt).toBe('2026-01-15T00:00:00.000Z');
    // Plain string should pass through
    expect(props.name).toBe('test');
    // _superjson metadata should be present
    expect(props._superjson).toBeDefined();
  });

  it('should pass through redirect results unchanged', async () => {
    const gssp = async () => ({
      redirect: { destination: '/login', permanent: false },
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());

    expect(result).toEqual({
      redirect: { destination: '/login', permanent: false },
    });
  });

  it('should pass through notFound results unchanged', async () => {
    const gssp = async () => ({
      notFound: true as const,
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());

    expect(result).toEqual({ notFound: true });
  });

  it('should handle plain JSON props (no special types)', async () => {
    const gssp = async () => ({
      props: { count: 42, items: ['a', 'b'] },
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());

    const props = (result as { props: Record<string, unknown> }).props;
    expect(props.count).toBe(42);
    expect(props.items).toEqual(['a', 'b']);
    // No _superjson metadata when no special types
    expect(props._superjson).toBeUndefined();
  });

  it('should handle Map and Set in props', async () => {
    const gssp = async () => ({
      props: { tags: new Set(['a', 'b']), lookup: new Map([['k', 'v']]) },
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());

    const props = (result as { props: Record<string, unknown> }).props;
    // Should have superjson metadata for Set and Map
    expect(props._superjson).toBeDefined();
  });

  it('should handle Promise-wrapped props', async () => {
    const gssp = async () => ({
      props: Promise.resolve({ value: 'deferred' }),
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());

    const props = (result as { props: Record<string, unknown> }).props;
    expect(props.value).toBe('deferred');
  });
});

describe('deserializeSuperJSONProps', () => {
  it('should deserialize Date from superjson-serialized props', () => {
    const original = {
      createdAt: new Date('2026-01-15T00:00:00.000Z'),
      name: 'test',
    };
    const { json, meta } = superjson.serialize(original);
    const serializedProps: Record<string, unknown> = {
      ...(json as Record<string, unknown>),
      _superjson: meta,
    };

    const result = deserializeSuperJSONProps(serializedProps);

    expect(result.createdAt).toBeInstanceOf(Date);
    expect((result.createdAt as Date).toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
    expect(result.name).toBe('test');
    // _superjson should be stripped
    expect(result).not.toHaveProperty('_superjson');
  });

  it('should pass through plain props without _superjson metadata', () => {
    const props = { count: 42, items: ['a', 'b'] };
    const result = deserializeSuperJSONProps(props);
    expect(result).toEqual({ count: 42, items: ['a', 'b'] });
  });

  it('should handle Map and Set deserialization', () => {
    const original = {
      tags: new Set(['a', 'b']),
      lookup: new Map([['k', 'v']]),
    };
    const { json, meta } = superjson.serialize(original);
    const serializedProps: Record<string, unknown> = {
      ...(json as Record<string, unknown>),
      _superjson: meta,
    };

    const result = deserializeSuperJSONProps(serializedProps);

    expect(result.tags).toBeInstanceOf(Set);
    expect(result.lookup).toBeInstanceOf(Map);
    expect(result.tags).toEqual(new Set(['a', 'b']));
    expect(result.lookup).toEqual(new Map([['k', 'v']]));
  });

  it('should work with withSuperJSONProps round-trip', async () => {
    const date = new Date('2026-06-15T12:00:00.000Z');
    const gssp = async () => ({
      props: { createdAt: date, name: 'round-trip', count: 5 },
    });

    const wrapped = withSuperJSONProps(gssp);
    const result = await wrapped(createMockContext());
    const serializedProps = (result as { props: Record<string, unknown> })
      .props;

    const deserialized = deserializeSuperJSONProps(serializedProps);

    expect(deserialized.createdAt).toBeInstanceOf(Date);
    expect((deserialized.createdAt as Date).toISOString()).toBe(
      '2026-06-15T12:00:00.000Z',
    );
    expect(deserialized.name).toBe('round-trip');
    expect(deserialized.count).toBe(5);
    expect(deserialized).not.toHaveProperty('_superjson');
  });
});
