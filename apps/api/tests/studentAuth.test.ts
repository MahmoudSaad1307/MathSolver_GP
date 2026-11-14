import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { hashPassword, signTeacherAccessToken } from '../src/lib/security.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

const TEACHER_ID = '11111111-1111-4111-8111-111111111111';

function extractCookie(res: request.Response, cookieName: string): string {
  const rawCookies = res.headers['set-cookie'];
  const list = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  const found = list.find((c) => c.startsWith(`${cookieName}=`));
  if (!found) {
    throw new Error(`Missing expected cookie: ${cookieName}`);
  }
  return found.split(';')[0]!;
}

describe('Student Account Auth, Multi-Quiz Enrollment, and Saved Exam History', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let prisma: ReturnType<typeof createInMemoryPrisma>;
  let app: ReturnType<typeof createApp>;
  let teacherToken: string;

  beforeEach(async () => {
    const passwordHash = await hashPassword('TeacherPass123!');
    prisma = createInMemoryPrisma([
      {
        id: TEACHER_ID,
        email: 'teacher@mathlens.local',
        passwordHash,
        displayName: 'أ. أحمد',
        role: 'TEACHER',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    app = createApp({ env, prisma, logger });
    teacherToken = signTeacherAccessToken(
      { id: TEACHER_ID, email: 'teacher@mathlens.local', role: 'TEACHER' },
      env,
    );
  });

  async function createPublishedTopicAndCohort(
    title: string,
    cohortName: string,
  ): Promise<{
    topicId: string;
    cohortId: string;
    joinCode: string;
  }> {
    const topicRes = await request(app)
      .post('/api/v1/topics')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ title, correctnessThreshold: 0.6 });
    const topicId = topicRes.body.topic.id as string;

    const models = topicRes.body.topic.examModels as Array<{ id: string; modelNumber: number }>;
    const m1 = models.find((m) => m.modelNumber === 1)!;
    const m2 = models.find((m) => m.modelNumber === 2)!;

    for (const model of [m1, m2]) {
      await request(app)
        .post(`/api/v1/exams/${model.id}/questions`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          orderIndex: 1,
          conceptKey: 'deriv-chain',
          type: 'MCQ',
          promptLatex: 'f(x) = x^2',
          points: 10,
          solutionUrl: 'https://example.com/solutions/deriv-chain',
          mcqOptions: [
            { label: 'A', textLatex: '2x', isCorrect: true },
            { label: 'B', textLatex: 'x', isCorrect: false },
            { label: 'C', textLatex: '2', isCorrect: false },
            { label: 'D', textLatex: '0', isCorrect: false },
          ],
        })
        .expect(201);
    }

    await request(app)
      .post(`/api/v1/exams/${m1.id}/publish`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    await request(app)
      .post(`/api/v1/exams/${m2.id}/publish`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    const cohortRes = await request(app)
      .post('/api/v1/cohorts')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        topicId,
        name: cohortName,
        group: 'TREATMENT',
      })
      .expect(201);

    return {
      topicId,
      cohortId: cohortRes.body.cohort.id as string,
      joinCode: cohortRes.body.cohort.joinCode as string,
    };
  }

  it('registers a student account, rejects duplicate emails, logs in, and rotates refresh tokens', async () => {
    const regRes = await request(app)
      .post('/api/v1/auth/student/register')
      .send({
        displayName: 'خالد العتيبي',
        email: 'Khalid@Student.MathLens.local',
        password: 'StudentPass123!',
        consentAccepted: true,
      })
      .expect(201);

    expect(regRes.body.account.email).toBe('khalid@student.mathlens.local');
    expect(regRes.body.account.displayName).toBe('خالد العتيبي');
    expect(regRes.body.account.role).toBe('STUDENT');
    expect(regRes.body.enrollments).toEqual([]);
    expect(regRes.body.activeEnrollmentId).toBeNull();

    const sessionCookie = extractCookie(regRes, 'ml_student_session');
    const refreshCookie = extractCookie(regRes, 'ml_student_refresh');
    expect(sessionCookie).toBeTruthy();
    expect(refreshCookie).toBeTruthy();

    // Duplicate registration fails with 409 EMAIL_ALREADY_REGISTERED
    const dupRes = await request(app)
      .post('/api/v1/auth/student/register')
      .send({
        displayName: 'خالد آخر',
        email: 'khalid@student.mathlens.local',
        password: 'AnotherPassword123!',
      })
      .expect(409);
    expect(dupRes.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

    // Calling /student/me/state before joining any quiz returns 400 NO_ACTIVE_QUIZ_SELECTED
    const noQuizRes = await request(app)
      .get('/api/v1/student/me/state')
      .set('Cookie', [sessionCookie])
      .expect(400);
    expect(noQuizRes.body.error.code).toBe('NO_ACTIVE_QUIZ_SELECTED');

    // Wrong password fails with 401 INVALID_CREDENTIALS
    await request(app)
      .post('/api/v1/auth/student/login')
      .send({
        email: 'khalid@student.mathlens.local',
        password: 'WrongPassword123!',
      })
      .expect(401);

    // Valid login succeeds
    const loginRes = await request(app)
      .post('/api/v1/auth/student/login')
      .send({
        email: 'khalid@student.mathlens.local',
        password: 'StudentPass123!',
      })
      .expect(200);
    expect(loginRes.body.account.email).toBe('khalid@student.mathlens.local');

    // Refresh token rotation and reuse detection
    const refresh1 = extractCookie(loginRes, 'ml_student_refresh');
    const rotatedRes = await request(app)
      .post('/api/v1/auth/student/refresh')
      .set('Cookie', [refresh1])
      .expect(200);
    const refresh2 = extractCookie(rotatedRes, 'ml_student_refresh');
    expect(refresh2).not.toBe(refresh1);

    // Replaying refresh1 revokes the token family
    await request(app).post('/api/v1/auth/student/refresh').set('Cookie', [refresh1]).expect(401);
    await request(app).post('/api/v1/auth/student/refresh').set('Cookie', [refresh2]).expect(401);
  });

  it('allows a logged-in student to enter multiple quiz codes, take exams, switch quizzes, and persist all history in their account', async () => {
    const quiz1 = await createPublishedTopicAndCohort(
      'تفاضل الدوال الأسية واللوغاريتمية',
      'شعبة التفاضل الأولى',
    );
    const quiz2 = await createPublishedTopicAndCohort(
      'تطبيقات القيم القصوى',
      'شعبة القيم القصوى الثانية',
    );

    // 1. Register student account
    const regRes = await request(app)
      .post('/api/v1/auth/student/register')
      .send({
        displayName: 'سارة الغامدي',
        email: 'sara@student.mathlens.local',
        password: 'StudentPass123!',
        consentAccepted: true,
      })
      .expect(201);

    let sessionCookie = extractCookie(regRes, 'ml_student_session');

    // 2. Enter Quiz Code #1
    const join1Res = await request(app)
      .post('/api/v1/student/join-quiz')
      .set('Cookie', [sessionCookie])
      .send({ joinCode: quiz1.joinCode })
      .expect(201);

    expect(join1Res.body.student.cohortId).toBe(quiz1.cohortId);
    expect(join1Res.body.student.email).toBe('sara@student.mathlens.local');
    const enrollment1Id = join1Res.body.student.id as string;
    sessionCookie = extractCookie(join1Res, 'ml_student_session');

    // Re-entering the same Quiz Code #1 is idempotent and returns the same enrollment
    const join1AgainRes = await request(app)
      .post('/api/v1/student/join-quiz')
      .set('Cookie', [sessionCookie])
      .send({ joinCode: quiz1.joinCode })
      .expect(201);
    expect(join1AgainRes.body.student.id).toBe(enrollment1Id);

    // 3. Start and submit Model 1 on Quiz #1
    const start1Res = await request(app)
      .post('/api/v1/student/attempts')
      .set('Cookie', [sessionCookie])
      .send({ modelNumber: 1 })
      .expect(200);
    const attempt1Id = start1Res.body.attempt.id as string;
    const q1 = start1Res.body.attempt.questions[0];

    await request(app)
      .put(`/api/v1/student/answers/${q1.answerId}`)
      .set('Cookie', [sessionCookie])
      .send({ selectedOptionId: q1.mcqOptions[0].id })
      .expect(200);

    await request(app)
      .post(`/api/v1/student/attempts/${attempt1Id}/submit`)
      .set('Cookie', [sessionCookie])
      .expect(200);

    // 4. Enter Quiz Code #2 under the same account
    const join2Res = await request(app)
      .post('/api/v1/student/join-quiz')
      .set('Cookie', [sessionCookie])
      .send({ joinCode: quiz2.joinCode })
      .expect(201);

    expect(join2Res.body.student.cohortId).toBe(quiz2.cohortId);
    const enrollment2Id = join2Res.body.student.id as string;
    expect(enrollment2Id).not.toBe(enrollment1Id);
    sessionCookie = extractCookie(join2Res, 'ml_student_session');

    // 5. Fetch account dashboard (/api/v1/auth/student/me) -> both quizzes and all attempts are saved
    const meRes = await request(app)
      .get('/api/v1/auth/student/me')
      .set('Cookie', [sessionCookie])
      .expect(200);

    expect(meRes.body.account.email).toBe('sara@student.mathlens.local');
    expect(meRes.body.activeEnrollmentId).toBe(enrollment2Id);
    expect(meRes.body.enrollments).toHaveLength(2);

    const savedQuiz1 = meRes.body.enrollments.find(
      (e: { studentId: string }) => e.studentId === enrollment1Id,
    );
    const savedQuiz2 = meRes.body.enrollments.find(
      (e: { studentId: string }) => e.studentId === enrollment2Id,
    );
    expect(savedQuiz1).toBeDefined();
    expect(savedQuiz1.topicTitle).toBe('تفاضل الدوال الأسية واللوغاريتمية');
    expect(savedQuiz1.preTestAttempt.status).toBe('GRADED');
    expect(savedQuiz1.preTestAttempt.totalScore).toBe(10);
    expect(savedQuiz2).toBeDefined();
    expect(savedQuiz2.topicTitle).toBe('تطبيقات القيم القصوى');
    expect(savedQuiz2.preTestAttempt).toBeNull();

    // 6. Student can view results of Quiz #1 even while Quiz #2 is active because both belong to their account
    const resultsRes = await request(app)
      .get(`/api/v1/student/attempts/${attempt1Id}/results`)
      .set('Cookie', [sessionCookie])
      .expect(200);
    expect(resultsRes.body.attempt.id).toBe(attempt1Id);
    expect(resultsRes.body.attempt.totalScore).toBe(10);

    // 7. Student can switch active quiz back to Quiz #1
    const selectRes = await request(app)
      .post(`/api/v1/student/enrollments/${enrollment1Id}/select`)
      .set('Cookie', [sessionCookie])
      .expect(200);
    expect(selectRes.body.student.id).toBe(enrollment1Id);
    expect(selectRes.body.student.cohortId).toBe(quiz1.cohortId);

    // 8. Teacher student list shows student email
    const teacherStudentsRes = await request(app)
      .get('/api/v1/students')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
    const saraRows = teacherStudentsRes.body.students.filter(
      (s: { email: string | null }) => s.email === 'sara@student.mathlens.local',
    );
    expect(saraRows).toHaveLength(2);
  });
});
