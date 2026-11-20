// Shared mock fns for the POST /summary specs; see summarize-message-harness.ts.
export const mocks = {
  getAgent: vi.fn(),
  stream: vi.fn(),
  incrementCount: vi.fn(),
  resolveEffectiveModelKey: vi.fn(),
  addActivity: vi.fn(),
  emitActivity: vi.fn(),
  takeActivityContext: vi.fn(),
  recordFailsafeAttempt: vi.fn(),
  recordAiUsage: vi.fn(),
  responseClosed: vi.fn(),
  // Awaited by the fake Page finders, so a test can hold the lookup open.
  pageLookup: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
  currentUser: undefined as unknown,
  activityBegun: true,
  // pageId -> body, read by the populateDataToShowRevision mock
  bodiesByPageId: new Map<string, string>(),
};
