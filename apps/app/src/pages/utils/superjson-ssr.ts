import type {
  GetServerSideProps,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
} from 'next';
import type { SuperJSONResult } from 'superjson';
import superjson from 'superjson';

/**
 * Wraps a getServerSideProps function to serialize its return props via superjson.
 *
 * Handles redirect/notFound pass-through, and supports Promise-wrapped props.
 * Adds `_superjson` metadata to props when non-JSON types (Date, Map, Set, etc.) are present.
 */
export function withSuperJSONProps<P extends Record<string, unknown>>(
  gssp: GetServerSideProps<P>,
): GetServerSideProps<P> {
  return async (context: GetServerSidePropsContext) => {
    const result: GetServerSidePropsResult<P> = await gssp(context);

    // Pass through redirect and notFound results unchanged
    if ('redirect' in result || 'notFound' in result) {
      return result;
    }

    if (!('props' in result) || result.props == null) {
      return result;
    }

    // Resolve potentially Promise-wrapped props
    const resolvedProps = await result.props;

    const { json, meta } = superjson.serialize(resolvedProps);

    // Spread the serialized JSON and add _superjson metadata if present
    const props = { ...(json as Record<string, unknown>) } as P;
    if (meta != null) {
      (props as Record<string, unknown>)._superjson = meta;
    }

    return { ...result, props };
  };
}

/**
 * Deserializes props that were serialized by withSuperJSONProps.
 *
 * If `_superjson` metadata is present, restores original types (Date, Map, Set, etc.).
 * If no metadata is present, returns props unchanged.
 */
export function deserializeSuperJSONProps<T extends Record<string, unknown>>(
  props: T,
): T {
  const metaField = (props as Record<string, unknown>)._superjson as
    | SuperJSONResult['meta']
    | undefined;

  if (metaField == null) {
    return props;
  }

  // Extract _superjson from the props to get the pure JSON
  const { _superjson: _, ...json } = props as Record<string, unknown>;

  return superjson.deserialize({
    json: json as SuperJSONResult['json'],
    meta: metaField,
  }) as T;
}
