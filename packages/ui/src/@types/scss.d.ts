// prevent TS2307: Cannot find module './xxx.module.scss' or its corresponding type declarations.
declare module '*.module.scss' {
  const classes: Record<string, string>;
  // biome-ignore lint/style/noDefaultExport: CSS Modules require default export
  export default classes;
}
