export * from './consts';
export * from './interfaces';

// Type declaration for RegExp.escape() (ES2026, Stage 4)
// Available natively in Node.js 24+ (V8 13.x+)
// Can be removed once TypeScript adds built-in support
declare global {
  interface RegExpConstructor {
    escape(str: string): string;
  }
}
