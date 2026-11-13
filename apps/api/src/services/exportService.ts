import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AppError } from '../lib/errors.js';
import { scopedCohortWhere } from '../lib/scoping.js';

const FORMULA_LEADING_RE = /^[=+\-@\t\r]/;

/** Neutralizes spreadsheet formula-injection payloads cleanly before CSV/XLSX writing. */
export function sanitizeSpreadsheetCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str =
    typeof value === 'string'
      ? value
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value);
  return FORMULA_LEADING_RE.test(str) ? `'${str}` : str;
}

function escapeCsvCell(value: unknown): string {
  const safe = String(sanitizeSpreadsheetCell(value));
  if (/[",\n\r]/.test(safe) || safe.startsWith("'")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cohort';
}

interface CohortExportData {
  cohortName: string;
  cohortGroup: string;
  joinCode: string;
  topicTitle: string;
  studentRows: Array<{
    displayName: string;
    resumeCode: string;
    preScore: number | null;
    preMax: number | null;
    prePct: number | null;
    preStatus: string;
    postScore: number | null;
    postMax: number | null;
    postPct: number | null;
    postStatus: string;
    deltaPct: number | null;
    hakeGain: number | null;
    watchedSeconds: number;
    unlockedAt: string;
  }>;
  questionRows: Array<{
    studentName: string;
    modelNumber: number;
    orderIndex: number;
    conceptKey: string;
    type: string;
    score: number | null;
    maxScore: number | null;
    isCorrect: boolean | null;
    errorType: string;
    firstErrorStep: number | null;
  }>;
  conceptRows: Array<{
    conceptKey: string;
    preAvgPct: number | null;
    postAvgPct: number | null;
    deltaPct: number | null;
    pairedSamples: number;
  }>;
  overrideRows: Array<{
    studentName: string;
    conceptKey: string;
    orderIndex: number;
    aiTotal: number;
    effectiveScore: number;
    confidence: number;
    needsReview: boolean;
    overrideNote: string;
    overrideAt: string;
  }>;
}

/** Exports cohort student, item, concept, and review audit data as CSV (UTF-8 BOM) or multi-sheet XLSX. */
export class ExportService {
  constructor(private readonly prisma: PrismaClient) {}

  private async loadCohortData(teacherId: string, cohortId: string): Promise<CohortExportData> {
    const cohort = await this.prisma.cohort.findFirst({
      where: { id: cohortId, ...scopedCohortWhere(teacherId) },
    });
    if (!cohort) {
      throw new AppError('NOT_FOUND');
    }

    const topic = await this.prisma.topic.findFirst({
      where: { id: cohort.topicId, deletedAt: null },
    });
    const examModels = await this.prisma.examModel.findMany({
      where: { topicId: cohort.topicId, deletedAt: null },
    });
    const modelById = new Map(examModels.map((m) => [m.id, m]));
    const modelIds = examModels.map((m) => m.id);
    const questions =
      modelIds.length > 0
        ? await this.prisma.question.findMany({
            where: { examModelId: { in: modelIds }, deletedAt: null },
          })
        : [];
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const students = await this.prisma.student.findMany({
      where: { cohortId: cohort.id, deletedAt: null },
    });
    const studentIds = students.map((s) => s.id);
    const [attempts, videoSessions] = await Promise.all([
      studentIds.length > 0
        ? this.prisma.attempt.findMany({ where: { studentId: { in: studentIds } } })
        : Promise.resolve([]),
      studentIds.length > 0
        ? this.prisma.videoSession.findMany({ where: { studentId: { in: studentIds } } })
        : Promise.resolve([]),
    ]);

    const attemptIds = attempts.map((a) => a.id);
    const answers =
      attemptIds.length > 0
        ? await this.prisma.answer.findMany({ where: { attemptId: { in: attemptIds } } })
        : [];
    const answerIds = answers.map((a) => a.id);
    const gradingResults =
      answerIds.length > 0
        ? await this.prisma.gradingResult.findMany({ where: { answerId: { in: answerIds } } })
        : [];

    const latestGrByAnswer = new Map<string, (typeof gradingResults)[number]>();
    for (const gr of gradingResults) {
      const prev = latestGrByAnswer.get(gr.answerId);
      if (!prev || gr.version > prev.version) latestGrByAnswer.set(gr.answerId, gr);
    }
    const grIds = Array.from(latestGrByAnswer.values()).map((g) => g.id);
    const overrides =
      grIds.length > 0
        ? await this.prisma.teacherOverride.findMany({
            where: { gradingResultId: { in: grIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [];
    const latestOverrideByGr = new Map<string, (typeof overrides)[number]>();
    for (const ov of overrides) {
      if (!latestOverrideByGr.has(ov.gradingResultId)) {
        latestOverrideByGr.set(ov.gradingResultId, ov);
      }
    }

    const attemptByStudentModel = new Map<string, (typeof attempts)[number]>();
    for (const att of attempts) {
      const m = modelById.get(att.examModelId);
      if (m) attemptByStudentModel.set(`${att.studentId}:${m.modelNumber}`, att);
    }

    const videoByStudent = new Map(videoSessions.map((v) => [v.studentId, v]));
    const studentById = new Map(students.map((s) => [s.id, s]));
    const attemptById = new Map(attempts.map((a) => [a.id, a]));

    const studentRows = students.map((stu) => {
      const pre = attemptByStudentModel.get(`${stu.id}:1`);
      const post = attemptByStudentModel.get(`${stu.id}:2`);
      const vs = videoByStudent.get(stu.id);
      const prePct = pre?.percentage ?? null;
      const postPct = post?.percentage ?? null;
      const deltaPct =
        prePct !== null && postPct !== null ? Math.round((postPct - prePct) * 100) / 100 : null;
      const hakeGain =
        prePct !== null && postPct !== null && prePct < 100
          ? Math.round(((postPct - prePct) / (100 - prePct)) * 10000) / 10000
          : null;

      return {
        displayName: stu.displayName,
        resumeCode: stu.resumeCode,
        preScore: pre?.totalScore ?? null,
        preMax: pre?.maxScore ?? null,
        prePct,
        preStatus: pre?.status ?? 'NOT_STARTED',
        postScore: post?.totalScore ?? null,
        postMax: post?.maxScore ?? null,
        postPct,
        postStatus: post?.status ?? 'NOT_STARTED',
        deltaPct,
        hakeGain,
        watchedSeconds: vs?.watchedSeconds ?? 0,
        unlockedAt: vs?.unlockedPostAt ? vs.unlockedPostAt.toISOString() : '',
      };
    });

    const conceptAgg = new Map<string, { prePcts: number[]; postPcts: number[] }>();
    const questionRows: CohortExportData['questionRows'] = [];
    const overrideRows: CohortExportData['overrideRows'] = [];

    for (const ans of answers) {
      const att = attemptById.get(ans.attemptId);
      const q = questionById.get(ans.questionId);
      if (!att || !q) continue;
      const stu = studentById.get(att.studentId);
      const model = modelById.get(att.examModelId);
      if (!stu || !model) continue;

      const gr = latestGrByAnswer.get(ans.id);
      questionRows.push({
        studentName: stu.displayName,
        modelNumber: model.modelNumber,
        orderIndex: q.orderIndex,
        conceptKey: q.conceptKey,
        type: q.type,
        score: ans.score,
        maxScore: ans.maxScore,
        isCorrect: ans.isCorrect,
        errorType: gr?.errorType ?? '',
        firstErrorStep: gr?.firstErrorStep ?? null,
      });

      if (q.points > 0 && ans.score !== null) {
        const pct = (ans.score / q.points) * 100;
        const cEntry = conceptAgg.get(q.conceptKey) ?? { prePcts: [], postPcts: [] };
        if (model.modelNumber === 1) cEntry.prePcts.push(pct);
        else cEntry.postPcts.push(pct);
        conceptAgg.set(q.conceptKey, cEntry);
      }

      if (gr) {
        const ov = latestOverrideByGr.get(gr.id);
        overrideRows.push({
          studentName: stu.displayName,
          conceptKey: q.conceptKey,
          orderIndex: q.orderIndex,
          aiTotal: gr.aiTotal,
          effectiveScore: ov ? ov.newTotal : (ans.score ?? gr.aiTotal),
          confidence: gr.confidence,
          needsReview: gr.needsReview,
          overrideNote: ov?.note ?? '',
          overrideAt: ov ? ov.createdAt.toISOString() : '',
        });
      }
    }

    const conceptRows: CohortExportData['conceptRows'] = Array.from(conceptAgg.entries()).map(
      ([key, c]) => {
        const preAvg =
          c.prePcts.length > 0
            ? Math.round((c.prePcts.reduce((a, b) => a + b, 0) / c.prePcts.length) * 100) / 100
            : null;
        const postAvg =
          c.postPcts.length > 0
            ? Math.round((c.postPcts.reduce((a, b) => a + b, 0) / c.postPcts.length) * 100) / 100
            : null;
        return {
          conceptKey: key,
          preAvgPct: preAvg,
          postAvgPct: postAvg,
          deltaPct:
            preAvg !== null && postAvg !== null ? Math.round((postAvg - preAvg) * 100) / 100 : null,
          pairedSamples: Math.min(c.prePcts.length, c.postPcts.length),
        };
      },
    );

    return {
      cohortName: cohort.name,
      cohortGroup: cohort.group,
      joinCode: cohort.joinCode,
      topicTitle: topic?.title ?? '',
      studentRows,
      questionRows,
      conceptRows,
      overrideRows,
    };
  }

  async exportCohortCsv(
    teacherId: string,
    cohortId: string,
  ): Promise<{ filename: string; content: string }> {
    const data = await this.loadCohortData(teacherId, cohortId);
    const headers = [
      'Student',
      'ResumeCode',
      'Group',
      'PreScore',
      'PreMax',
      'PrePct',
      'PreStatus',
      'PostScore',
      'PostMax',
      'PostPct',
      'PostStatus',
      'DeltaPct',
      'HakeGain',
      'WatchedSeconds',
      'UnlockedAt',
    ];
    const lines = [headers.join(',')];
    for (const row of data.studentRows) {
      lines.push(
        [
          row.displayName,
          row.resumeCode,
          data.cohortGroup,
          row.preScore ?? '',
          row.preMax ?? '',
          row.prePct ?? '',
          row.preStatus,
          row.postScore ?? '',
          row.postMax ?? '',
          row.postPct ?? '',
          row.postStatus,
          row.deltaPct ?? '',
          row.hakeGain ?? '',
          row.watchedSeconds,
          row.unlockedAt,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }

    return {
      filename: `${sanitizeFilename(data.cohortName)}-${data.joinCode}.csv`,
      content: `\uFEFF${lines.join('\r\n')}\r\n`,
    };
  }

  async exportCohortXlsx(
    teacherId: string,
    cohortId: string,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const data = await this.loadCohortData(teacherId, cohortId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MathLens';
    workbook.created = new Date();

    const addSanitizedRow = (sheet: ExcelJS.Worksheet, values: unknown[]) => {
      sheet.addRow(values.map((v) => sanitizeSpreadsheetCell(v)));
    };

    const pairedRows = data.studentRows.filter((r) => r.prePct !== null && r.postPct !== null);
    const avgPre =
      pairedRows.length > 0
        ? pairedRows.reduce((a, r) => a + r.prePct!, 0) / pairedRows.length
        : null;
    const avgPost =
      pairedRows.length > 0
        ? pairedRows.reduce((a, r) => a + r.postPct!, 0) / pairedRows.length
        : null;

    const summarySheet = workbook.addWorksheet('Summary');
    addSanitizedRow(summarySheet, ['Field', 'Value']);
    addSanitizedRow(summarySheet, ['Cohort', data.cohortName]);
    addSanitizedRow(summarySheet, ['Group', data.cohortGroup]);
    addSanitizedRow(summarySheet, ['JoinCode', data.joinCode]);
    addSanitizedRow(summarySheet, ['Topic', data.topicTitle]);
    addSanitizedRow(summarySheet, ['TotalStudents', data.studentRows.length]);
    addSanitizedRow(summarySheet, ['PairedStudents', pairedRows.length]);
    addSanitizedRow(summarySheet, [
      'AvgPrePct',
      avgPre !== null ? Math.round(avgPre * 100) / 100 : '',
    ]);
    addSanitizedRow(summarySheet, [
      'AvgPostPct',
      avgPost !== null ? Math.round(avgPost * 100) / 100 : '',
    ]);

    const studentsSheet = workbook.addWorksheet('Students');
    addSanitizedRow(studentsSheet, [
      'Student',
      'ResumeCode',
      'PreScore',
      'PreMax',
      'PrePct',
      'PreStatus',
      'PostScore',
      'PostMax',
      'PostPct',
      'PostStatus',
      'DeltaPct',
      'HakeGain',
      'WatchedSeconds',
      'UnlockedAt',
    ]);
    for (const r of data.studentRows) {
      addSanitizedRow(studentsSheet, [
        r.displayName,
        r.resumeCode,
        r.preScore,
        r.preMax,
        r.prePct,
        r.preStatus,
        r.postScore,
        r.postMax,
        r.postPct,
        r.postStatus,
        r.deltaPct,
        r.hakeGain,
        r.watchedSeconds,
        r.unlockedAt,
      ]);
    }

    const questionsSheet = workbook.addWorksheet('Questions');
    addSanitizedRow(questionsSheet, [
      'Student',
      'ModelNumber',
      'OrderIndex',
      'ConceptKey',
      'Type',
      'Score',
      'MaxScore',
      'IsCorrect',
      'ErrorType',
      'FirstErrorStep',
    ]);
    for (const r of data.questionRows) {
      addSanitizedRow(questionsSheet, [
        r.studentName,
        r.modelNumber,
        r.orderIndex,
        r.conceptKey,
        r.type,
        r.score,
        r.maxScore,
        r.isCorrect,
        r.errorType,
        r.firstErrorStep,
      ]);
    }

    const conceptsSheet = workbook.addWorksheet('Concepts');
    addSanitizedRow(conceptsSheet, [
      'ConceptKey',
      'PreAvgPct',
      'PostAvgPct',
      'DeltaPct',
      'PairedSamples',
    ]);
    for (const r of data.conceptRows) {
      addSanitizedRow(conceptsSheet, [
        r.conceptKey,
        r.preAvgPct,
        r.postAvgPct,
        r.deltaPct,
        r.pairedSamples,
      ]);
    }

    const reviewSheet = workbook.addWorksheet('Reviews & Overrides');
    addSanitizedRow(reviewSheet, [
      'Student',
      'ConceptKey',
      'OrderIndex',
      'AiTotal',
      'EffectiveScore',
      'Confidence',
      'NeedsReview',
      'OverrideNote',
      'OverrideAt',
    ]);
    for (const r of data.overrideRows) {
      addSanitizedRow(reviewSheet, [
        r.studentName,
        r.conceptKey,
        r.orderIndex,
        r.aiTotal,
        r.effectiveScore,
        r.confidence,
        r.needsReview,
        r.overrideNote,
        r.overrideAt,
      ]);
    }

    const arrayBuf = await workbook.xlsx.writeBuffer();
    return {
      filename: `${sanitizeFilename(data.cohortName)}-${data.joinCode}.xlsx`,
      buffer: Buffer.from(arrayBuf),
    };
  }
}
