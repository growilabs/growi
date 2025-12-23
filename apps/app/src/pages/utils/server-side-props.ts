import type { GetServerSidePropsResult } from 'next';
import deepMerge from 'ts-deepmerge';

// Type-safe GetServerSidePropsResult merger for two results
export function mergeGetServerSidePropsResults<T1, T2>(
  result1: GetServerSidePropsResult<T1>,
  result2: GetServerSidePropsResult<T2>,
): GetServerSidePropsResult<T1 & T2> {
  // Check for redirect responses (return the first one found)
  if ('redirect' in result1) return result1;
  if ('redirect' in result2) return result2;

  // Check for notFound responses (return the first one found)
  if ('notFound' in result1) return result1;
  if ('notFound' in result2) return result2;

  // Both results must have props for successful merge
  if (!('props' in result1) || !('props' in result2)) {
    throw new Error('Invalid GetServerSidePropsResult - missing props');
  }

  return deepMerge(result1, result2) as GetServerSidePropsResult<T1 & T2>;
}
