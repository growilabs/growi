declare module 'plantuml-encoder' {
  export function encode(source: string): string;
  export function decode(encoded: string): string;
}
