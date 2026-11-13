import { initAttachmentFullTextSearch } from './index';

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn().mockReturnValue(null),
  },
}));

describe('initAttachmentFullTextSearch', () => {
  it('returns void when feature is disabled (no URI/token)', () => {
    const fakeCrowi = {
      searchService: { isConfigured: false },
      attachmentService: {},
      socketIoService: {},
      fileUploadService: {},
    } as unknown as Parameters<typeof initAttachmentFullTextSearch>[0];

    expect(() => initAttachmentFullTextSearch(fakeCrowi)).not.toThrow();
  });

  it('does not register handlers when searchService is not configured', () => {
    const addAttachHandler = vi.fn();
    const addDetachHandler = vi.fn();
    const fakeCrowi = {
      searchService: { isConfigured: false },
      attachmentService: { addAttachHandler, addDetachHandler },
      socketIoService: {},
      fileUploadService: {},
    } as unknown as Parameters<typeof initAttachmentFullTextSearch>[0];

    initAttachmentFullTextSearch(fakeCrowi);

    expect(addAttachHandler).not.toHaveBeenCalled();
    expect(addDetachHandler).not.toHaveBeenCalled();
  });
});
