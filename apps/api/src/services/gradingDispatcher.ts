export interface EssayGradingJobPayload {
  attemptId: string;
  answerId: string;
  studentId: string;
}

export interface GradingDispatcher {
  enqueueEssayGrading(payload: EssayGradingJobPayload): Promise<void>;
}

export class NoopGradingDispatcher implements GradingDispatcher {
  enqueueEssayGrading(_payload: EssayGradingJobPayload): Promise<void> {
    return Promise.resolve();
  }
}
