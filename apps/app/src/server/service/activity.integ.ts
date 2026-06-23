import EventEmitter from 'events';
import { type MockProxy, mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';
import ActivityService from '~/server/service/activity';

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('ActivityService.createActivity()', () => {
  let mockCrowi: MockProxy<Crowi>;
  let activityService: ActivityService;
  let activityEvent: EventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    activityEvent = new EventEmitter();
    emitSpy = vi.spyOn(activityEvent, 'emit');
    mockCrowi = mock<Crowi>();
    mockCrowi.events.activity = activityEvent;
    activityService = new ActivityService(mockCrowi);
    mockCrowi.activityService = activityService;
  });

  afterEach(async () => {
    await Activity.deleteMany({});
  });

  it('should emit "created" and return the activity when created successfully', async () => {
    vi.spyOn(activityService, 'shoudUpdateActivity').mockReturnValue(true);

    const result = await activityService.createActivity({
      action: SupportedAction.ACTION_PAGE_CREATE,
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'created',
      expect.objectContaining({
        action: SupportedAction.ACTION_PAGE_CREATE,
      }),
    );
    expect(result).toMatchObject({
      action: SupportedAction.ACTION_PAGE_CREATE,
    });
  });

  it('should return null without emitting when shoudUpdateActivity returns false', async () => {
    vi.spyOn(activityService, 'shoudUpdateActivity').mockReturnValue(false);

    const result = await activityService.createActivity({
      action: SupportedAction.ACTION_PAGE_CREATE,
    });

    expect(result).toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should return null without emitting when Activity creation throws', async () => {
    vi.spyOn(activityService, 'shoudUpdateActivity').mockReturnValue(true);

    const result = await activityService.createActivity({
      action: 'INVALID_ACTION',
    });

    expect(result).toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
