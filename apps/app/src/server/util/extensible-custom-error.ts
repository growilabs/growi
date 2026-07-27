import ExtensibleCustomErrorPkg from 'extensible-custom-error';

/**
 * Runtime-correct, NodeNext-typed adapter for `extensible-custom-error`.
 *
 * The package is plain CJS (`module.exports = class ExtensibleCustomError`),
 * so the ESM default import binding IS the class at runtime. Its bundled
 * declaration says `export default`, which NodeNext models as the module
 * namespace, so the binding must be narrowed back to the constructor type.
 */
export const ExtensibleCustomError =
  ExtensibleCustomErrorPkg as unknown as typeof import('extensible-custom-error').default;
export type ExtensibleCustomError = import('extensible-custom-error').default;
