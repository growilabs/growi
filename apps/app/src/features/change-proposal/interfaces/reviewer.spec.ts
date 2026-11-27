import type {
  ApproveResponse,
  ChangeProposalView,
  DecisionResponse,
  OperationView,
  ReviewChannel,
  ReviewerInput,
  ReviewerKind,
  ReviewerRef,
  ReviewKind,
  ReviewRecord,
  ReviewRequestNotificationSnapshot,
  ReviewResultNotificationSnapshot,
  ViewerRole,
} from '.';
import {
  MAX_PURPOSE_LENGTH,
  MAX_REVIEW_COMMENT_LENGTH,
  MAX_REVIEWERS,
} from '.';

describe('reviewer interfaces barrel', () => {
  it('declares the reviewer, comment and purpose limits (Req 15.7, 15.9, 17.6)', () => {
    expect(MAX_REVIEWERS).toBe(20);
    expect(MAX_REVIEW_COMMENT_LENGTH).toBe(500);
    expect(MAX_PURPOSE_LENGTH).toBe(2000);
  });

  it('declares the reviewer, decision and channel vocabularies', () => {
    expectTypeOf<ReviewerKind>().toEqualTypeOf<
      'user' | 'user-group' | 'external-user-group'
    >();
    expectTypeOf<ReviewChannel>().toEqualTypeOf<'ui' | 'api' | 'ai-tool'>();
    expectTypeOf<ReviewKind>().toEqualTypeOf<'reject' | 'abstain'>();
    expectTypeOf<ViewerRole>().toEqualTypeOf<
      'requester' | 'reviewer' | 'other'
    >();
    expectTypeOf<ReviewerInput>().toEqualTypeOf<{
      readonly kind: ReviewerKind;
      readonly id: string;
    }>();
    expectTypeOf<ReviewerRef['removedAt']>().toEqualTypeOf<Date | undefined>();
    expectTypeOf<ReviewRecord['operationKey']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<ReviewRecord['channel']>().toEqualTypeOf<ReviewChannel>();
  });

  it('adds the role and the reviewer-facing values to the views (Req 19.1, 19.2, 19.7)', () => {
    expectTypeOf<
      ChangeProposalView['viewerRole']
    >().toEqualTypeOf<ViewerRole>();
    expectTypeOf<ChangeProposalView['purpose']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<ChangeProposalView['reviewers']>().not.toBeNever();
    expectTypeOf<ChangeProposalView['wholeRejections']>().not.toBeNever();
    expectTypeOf<OperationView['baseIsLatest']>().toEqualTypeOf<
      boolean | undefined
    >();
    expectTypeOf<OperationView['order']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<OperationView['approval']>().not.toBeNever();
    expectTypeOf<OperationView['rejections']>().not.toBeNever();
    expectTypeOf<OperationView['abstentions']>().not.toBeNever();
  });

  it('adds the review notification kinds', () => {
    expectTypeOf<
      ReviewRequestNotificationSnapshot['kind']
    >().toEqualTypeOf<'review-request'>();
    expectTypeOf<
      ReviewResultNotificationSnapshot['kind']
    >().toEqualTypeOf<'review-result'>();
    expectTypeOf<
      ReviewResultNotificationSnapshot['items'][number]['result']
    >().toEqualTypeOf<'approved' | 'rejected' | 'abstained'>();
    expectTypeOf<
      ReviewResultNotificationSnapshot['wholeRejection']
    >().not.toBeNever();
  });

  it('declares the approve and decision responses', () => {
    expectTypeOf<DecisionResponse['type']>().toEqualTypeOf<'done'>();
    expectTypeOf<ApproveResponse['type']>().toEqualTypeOf<
      'done' | 'in-progress'
    >();
  });
});
