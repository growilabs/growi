// Public API of the safe-redirect middleware module.
// Internals (the pure resolveSafeRedirect() and its types in ./target) stay unexported.
export {
  type ResWithSafeRedirect,
  registerSafeRedirectFactory,
} from './middleware';
