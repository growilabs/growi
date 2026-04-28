// prevent TS2307: Cannot find module './xxx.module.scss' or its corresponding type declarations.
declare module '*.module.scss' {
  const classes: Record<string, string>;
  // biome-ignore lint/style/noDefaultExport: CSS Modules require default export
  export default classes;
}

// prevent TS7016: Could not find a declaration file for module 'emoji-mart'.
declare module 'emoji-mart';
