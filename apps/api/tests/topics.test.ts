import { readFileSync } from 'node:fs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { SeedTopicBundleSchema } from '@mathlens/shared';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { hashPassword, signTeacherAccessToken } from '../src/lib/security.js';
import { ExamImportExportService } from '../src/services/examImportExportService.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

const TEACHER_A_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_B_ID = '22222222-2222-4222-8222-222222222222';

describe('Teacher content builder, rubric guard, import/export, and publish checklist', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let app: ReturnType<typeof createApp>;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    const passwordHash = await hashPassword('TeacherPass123!');
    prisma = createInMemoryPrisma([
      {
        id: TEACHER_A_ID,
        email: 'teacher-a@mathlens.local',
        passwordHash,
        displayName: 'أ. أحمد',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: TEACHER_B_ID,
        email: 'teacher-b@mathlens.local',
        passwordHash,
        displayName: 'أ. سارة',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);
    app = createApp({ env, prisma, logger });
    tokenA = signTeacherAccessToken(
      { id: TEACHER_A_ID, email: 'teacher-a@mathlens.local', role: 'TEACHER' },
      env,
    );
    tokenB = signTeacherAccessToken(
      { id: TEACHER_B_ID, email: 'teacher-b@mathlens.local', role: 'TEACHER' },
      env,
    );
  });

  it('requires authentication on teacher content endpoints', async () => {
    const res = await request(app).get('/api/v1/topics');
    expect(res.status).toBe(401);
  });

  it('creates paired Model 1 & 2, isolates ownership across teachers, and supports soft delete', async () => {
    const createRes = await request(app)
      .post('/api/v1/topics')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'الاشتقاق اللوغاريتمي',
        description: 'موضوع تدريبي',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        minWatchSeconds: 300,
      });

    expect(createRes.status).toBe(201);
    const topic = createRes.body.topic;
    expect(topic.videoId).toBe('dQw4w9WgXcQ');
    expect(topic.examModels).toHaveLength(2);
    expect(topic.examModels[0].pairedWithId).toBe(topic.examModels[1].id);
    expect(topic.examModels[1].pairedWithId).toBe(topic.examModels[0].id);

    // Teacher B cannot list, inspect, patch, or delete Teacher A's topic
    const listB = await request(app).get('/api/v1/topics').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.status).toBe(200);
    expect(listB.body.topics).toHaveLength(0);

    const getB = await request(app)
      .get(`/api/v1/topics/${topic.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(getB.status).toBe(404);

    const patchB = await request(app)
      .patch(`/api/v1/topics/${topic.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'اختراق' });
    expect(patchB.status).toBe(404);

    // Teacher A updates and deletes cleanly
    const patchA = await request(app)
      .patch(`/api/v1/topics/${topic.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ videoUrl: 'https://www.youtube.com/watch?v=REPLACE_ME' });
    expect(patchA.status).toBe(200);
    expect(patchA.body.topic.videoId).toBeNull();
    expect(patchA.body.topic.hasMissingVideo).toBe(true);

    const delA = await request(app)
      .delete(`/api/v1/topics/${topic.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(delA.status).toBe(204);

    const listA = await request(app).get('/api/v1/topics').set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.topics).toHaveLength(0);
  });

  it('enforces rubric sums, pairs twin questions, recalculates totalPoints, and bumps rubricVersion', async () => {
    const createRes = await request(app)
      .post('/api/v1/topics')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'الدوال الأسية',
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      });
    const [m1, m2] = createRes.body.topic.examModels;

    // Invalid rubric sum on question create is rejected
    const badEssay = await request(app)
      .post(`/api/v1/exams/${m1.id}/questions`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderIndex: 1,
        conceptKey: 'exp-diff',
        type: 'ESSAY',
        promptLatex: 'Find $y^{\\prime}$ for $y = e^{2x}$.',
        points: 10,
        videoTimestampSeconds: 45,
        modelAnswer: {
          solutionStepsLatex: ['$y^{\\prime} = 2e^{2x}$'],
          finalAnswerLatex: '$2e^{2x}$',
          finalAnswerSympy: '2*exp(2*x)',
        },
        rubricCriteria: [
          {
            orderIndex: 1,
            key: 'chain',
            descriptionEn: 'Chain rule',
            descriptionAr: 'تطبيق قاعدة السلسلة',
            maxPoints: 6,
          },
        ],
      });
    expect(badEssay.status).toBe(400);

    // Valid essays in Model 1 & Model 2 pair as twins
    const validEssayPayload = (prompt: string) => ({
      orderIndex: 1,
      conceptKey: 'exp-diff',
      type: 'ESSAY',
      promptLatex: prompt,
      points: 10,
      videoTimestampSeconds: 45,
      modelAnswer: {
        solutionStepsLatex: ['$y^{\\prime} = 2e^{2x}$'],
        finalAnswerLatex: '$2e^{2x}$',
        finalAnswerSympy: '2*exp(2*x)',
      },
      rubricCriteria: [
        {
          orderIndex: 1,
          key: 'rule',
          descriptionEn: 'Derivative rule',
          descriptionAr: 'تطبيق قاعدة التفاضل',
          maxPoints: 6,
        },
        {
          orderIndex: 2,
          key: 'final',
          descriptionEn: 'Final answer',
          descriptionAr: 'الناتج النهائي',
          maxPoints: 4,
        },
      ],
    });

    const q1Res = await request(app)
      .post(`/api/v1/exams/${m1.id}/questions`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validEssayPayload('Model 1: Find derivative of $e^{2x}$'));
    expect(q1Res.status).toBe(201);
    const q1Id = q1Res.body.question.id;

    const q2Res = await request(app)
      .post(`/api/v1/exams/${m2.id}/questions`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validEssayPayload('Model 2: Find derivative of $e^{5x}$'));
    expect(q2Res.status).toBe(201);
    const q2Id = q2Res.body.question.id;

    // Verify twin pairing and recalculated totalPoints
    const m1Get = await request(app)
      .get(`/api/v1/exams/${m1.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(m1Get.body.exam.totalPoints).toBe(10);
    expect(m1Get.body.exam.questions[0].twinQuestionId).toBe(q2Id);

    // PUT /rubric rejects sum mismatch with RUBRIC_SUM_MISMATCH and bumps version when valid
    const badRubricPut = await request(app)
      .put(`/api/v1/questions/${q1Id}/rubric`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        criteria: [
          {
            orderIndex: 1,
            key: 'only',
            descriptionEn: 'Only',
            descriptionAr: 'بند واحد',
            maxPoints: 5,
          },
        ],
      });
    expect(badRubricPut.status).toBe(400);
    expect(badRubricPut.body.error.code).toBe('RUBRIC_SUM_MISMATCH');

    const goodRubricPut = await request(app)
      .put(`/api/v1/questions/${q1Id}/rubric`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        criteria: [
          {
            orderIndex: 1,
            key: 'full',
            descriptionEn: 'Full solution',
            descriptionAr: 'الحل الكامل',
            maxPoints: 10,
          },
        ],
      });
    expect(goodRubricPut.status).toBe(200);
    expect(goodRubricPut.body.question.modelAnswer.rubricVersion).toBe(2);

    // Deleting Q2 clears Q1 twin link
    const delQ2 = await request(app)
      .delete(`/api/v1/questions/${q2Id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(delQ2.status).toBe(204);

    const m1AfterDel = await request(app)
      .get(`/api/v1/exams/${m1.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(m1AfterDel.body.exam.questions[0].twinQuestionId).toBeNull();
  });

  it('supports dryRun import diff, applies seed bundle, gates publishing on checklist, and exports JSON', async () => {
    const rawSeed = readFileSync(new URL('../../../seed/exams.seed.json', import.meta.url), 'utf8');
    const seedBundle = SeedTopicBundleSchema.parse(JSON.parse(rawSeed));

    // Dry run creates nothing
    const dryRes = await request(app)
      .post('/api/v1/exams/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dryRun: true, bundle: seedBundle });
    expect(dryRes.status).toBe(200);
    expect(dryRes.body.dryRun).toBe(true);
    expect(dryRes.body.applied).toBe(false);
    expect(prisma._state.topics).toHaveLength(0);

    // Apply import
    const applyRes = await request(app)
      .post('/api/v1/exams/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dryRun: false, bundle: seedBundle });
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.applied).toBe(true);

    const topic = applyRes.body.topic;
    expect(topic.hasPlaceholders).toBe(true);
    expect(topic.zeroTimestampCount).toBe(20);
    expect(topic.unconfirmedCount).toBe(2);
    expect(topic.examModels[0].totalPoints).toBe(100);
    expect(topic.examModels[1].totalPoints).toBe(100);

    const m1 = topic.examModels[0];
    const m2 = topic.examModels[1];

    // Publishing is blocked while placeholders/unconfirmed Q3 remain
    const blockedPub = await request(app)
      .post(`/api/v1/exams/${m1.id}/publish`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(blockedPub.status).toBe(400);
    expect(blockedPub.body.error.code).toBe('PUBLISH_CHECKLIST_FAILED');

    // Also patching status directly to PUBLISHED must run checklist
    const blockedPatch = await request(app)
      .patch(`/api/v1/exams/${m1.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'PUBLISHED' });
    expect(blockedPatch.status).toBe(400);
    expect(blockedPatch.body.error.code).toBe('PUBLISH_CHECKLIST_FAILED');

    // Fill real YouTube URL, confirm both Q3s, and set non-zero timestamps
    await request(app)
      .patch(`/api/v1/topics/${topic.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ' });

    for (const model of [m1, m2]) {
      for (const q of model.questions) {
        if (q.needsTeacherConfirmation) {
          const confirmRes = await request(app)
            .post(`/api/v1/questions/${q.id}/confirm`)
            .set('Authorization', `Bearer ${tokenA}`);
          expect(confirmRes.status).toBe(200);
          expect(confirmRes.body.question.needsTeacherConfirmation).toBe(false);
        }

        await request(app)
          .patch(`/api/v1/questions/${q.id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            orderIndex: q.orderIndex,
            conceptKey: q.conceptKey,
            type: q.type,
            promptLatex: q.promptLatex,
            points: q.points,
            videoTimestampSeconds: q.orderIndex * 45,
            needsTeacherConfirmation: false,
            ...(q.type === 'MCQ'
              ? {
                  mcqOptions: q.mcqOptions.map(
                    (o: { label: string; textLatex: string; isCorrect: boolean }) => ({
                      label: o.label,
                      textLatex: o.textLatex,
                      isCorrect: o.isCorrect,
                    }),
                  ),
                }
              : {
                  modelAnswer: {
                    solutionStepsLatex: q.modelAnswer.solutionStepsLatex,
                    finalAnswerLatex: q.modelAnswer.finalAnswerLatex,
                    finalAnswerSympy: q.modelAnswer.finalAnswerSympy,
                    commonMistakes: q.modelAnswer.commonMistakes,
                  },
                  rubricCriteria: q.rubricCriteria.map(
                    (c: {
                      orderIndex: number;
                      key: string;
                      descriptionEn: string;
                      descriptionAr: string;
                      maxPoints: number;
                    }) => ({
                      orderIndex: c.orderIndex,
                      key: c.key,
                      descriptionEn: c.descriptionEn,
                      descriptionAr: c.descriptionAr,
                      maxPoints: c.maxPoints,
                    }),
                  ),
                }),
          });
      }
    }

    // Now publish succeeds!
    const pub1 = await request(app)
      .post(`/api/v1/exams/${m1.id}/publish`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(pub1.status).toBe(200);
    expect(pub1.body.exam.status).toBe('PUBLISHED');

    // Unpublish toggles back to DRAFT
    const unpub1 = await request(app)
      .post(`/api/v1/exams/${m1.id}/unpublish`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(unpub1.status).toBe(200);
    expect(unpub1.body.exam.status).toBe('DRAFT');

    // Export bundle and validate schema
    const exportRes = await request(app)
      .get(`/api/v1/topics/${topic.id}/export?download=1`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers['content-disposition']).toContain('attachment;');
    const exported = SeedTopicBundleSchema.parse(exportRes.body);
    expect(exported.topic.videoUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(exported.models[0].questions[0].videoTimestampSeconds).toBe(45);

    // Seed helper is idempotent
    const svc = new ExamImportExportService(prisma, env);
    const secondSeed = await svc.seedTopicBundleIfMissing(TEACHER_A_ID, seedBundle);
    expect(secondSeed.seeded).toBe(false);
    expect(secondSeed.topicId).toBe(topic.id);

    // Inspect /topics/:id/exams and update exam duration
    const examsRes = await request(app)
      .get(`/api/v1/topics/${topic.id}/exams`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(examsRes.status).toBe(200);
    expect(examsRes.body.models).toHaveLength(2);

    const patchExamRes = await request(app)
      .patch(`/api/v1/exams/${m1.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ durationMinutes: 75, title: 'نموذج 1 محدث' });
    expect(patchExamRes.status).toBe(200);
    expect(patchExamRes.body.exam.durationMinutes).toBe(75);

    // Re-import over targetTopicId with dryRun diff and apply
    const modifiedBundle = {
      ...exported,
      topic: { ...exported.topic, title: 'Updated Topic Title' },
      models: [
        { ...exported.models[0], questions: exported.models[0].questions.slice(0, 9) },
        exported.models[1],
      ],
    };

    const reimportDry = await request(app)
      .post('/api/v1/exams/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dryRun: true, targetTopicId: topic.id, bundle: modifiedBundle });
    expect(reimportDry.status).toBe(200);
    expect(reimportDry.body.diff.mode).toBe('UPDATE_TOPIC');
    expect(reimportDry.body.diff.models[0].removedOrderIndexes).toEqual([10]);

    const reimportApply = await request(app)
      .post('/api/v1/exams/import')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dryRun: false, targetTopicId: topic.id, bundle: modifiedBundle });
    expect(reimportApply.status).toBe(200);
    expect(reimportApply.body.topic.title).toBe('Updated Topic Title');
    expect(reimportApply.body.topic.examModels[0].questions).toHaveLength(9);
  });
});
