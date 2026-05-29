import EventEmitter from 'events';
import mongoose from 'mongoose';
import { vi } from 'vitest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import {
  SupportedAction,
  type SupportedActionType,
} from '~/interfaces/activity';
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

  beforeAll(async () => {
    await mongoose.connect('mongodb://mongo:27017/growi-test-activity-spec');
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

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

  it('should emit "created" when activity is created successfully', async () => {
    vi.spyOn(activityService, 'shoudUpdateActivity').mockReturnValue(true);

    await activityService.createActivity({
      action: SupportedAction.ACTION_PAGE_CREATE,
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'created',
      expect.objectContaining({
        action: SupportedAction.ACTION_PAGE_CREATE,
      }),
    );
  });

  it('should not emit "created" when shoudUpdateActivity returns false', async () => {
    vi.spyOn(activityService, 'shoudUpdateActivity').mockReturnValue(false);

    await activityService.createActivity({
      action: SupportedAction.ACTION_PAGE_CREATE,
    });

    expect(emitSpy).not.toHaveBeenCalledWith('created', expect.anything());
  });

  it('should not emit "created" when Activity creation throws', async () => {
    vi.spyOn(activityService, 'shoudUpdateActivity').mockReturnValue(true);

    await activityService.createActivity({
      action: 'INVALID_ACTION' as unknown as SupportedActionType,
    });

    expect(emitSpy).not.toHaveBeenCalledWith('created', expect.anything());
  });
});
