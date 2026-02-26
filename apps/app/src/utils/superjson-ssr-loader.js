/**
 * Webpack loader that auto-wraps getServerSideProps with withSuperJSONProps.
 *
 * Replaces the `next-superjson` SWC plugin with a zero-dependency source transform.
 * Targets `.page.{ts,tsx}` files that export `getServerSideProps`.
 *
 * Transform:
 *   export const getServerSideProps: ... = async (ctx) => { ... };
 * becomes:
 *   import { withSuperJSONProps as __withSuperJSONProps__ } from '~/pages/utils/superjson-ssr';
 *   const __getServerSideProps__: ... = async (ctx) => { ... };
 *   export const getServerSideProps = __withSuperJSONProps__(__getServerSideProps__);
 */
module.exports = function superjsonSsrLoader(source) {
  if (!/export\s+const\s+getServerSideProps\b/.test(source)) {
    return source;
  }

  const importLine =
    "import { withSuperJSONProps as __withSuperJSONProps__ } from '~/pages/utils/superjson-ssr';\n";

  const renamed = source.replace(
    /export\s+const\s+getServerSideProps\b/,
    'const __getServerSideProps__',
  );

  return (
    importLine +
    renamed +
    '\nexport const getServerSideProps = __withSuperJSONProps__(__getServerSideProps__);\n'
  );
};
