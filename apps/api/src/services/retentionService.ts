import type { PrismaClient } from '@prisma/client';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { scopedCohortWhere } from '../lib/scoping.js';
import { hashIp } from '../lib/security.js';
import { extractStorageKeysFromJob } from './pdfImportService.js';
import type { StorageAdapter } from './storage/index.js';

export interface RetentionRunSummary {
  scanned: number;
  deleted: number;
  skippedActiveOrPinned: number;
  storageErrors: number;
  cutoffIso: string;
}

function isMissingObjectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string; name?: string }).code;
  const name = (err as { name?: string }).name;
  return code === 'ENOENT' || code === 'NoSuchKey' || name === 'NoSuchKey';
}

export class RetentionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageAdapter,
    private readonly logger?: Logger,
  ) {}

  private async purgeImageBatch(
    images: Array<{ id: string; storageKey: string }>,
    actorType: 'TEACHER' | 'STUDENT' | 'SYSTEM',
    actorId: string,
    action: string,
    now: Date,
    ipHash: string,
  ): Promise<{ deleted: number; storageErrors: number }> {
    let deleted = 0;
    let storageErrors = 0;

    for (const img of images) {
      try {
        await this.storage.deleteObject(img.storageKey);
      } catch (err) {
        if (!isMissingObjectError(err)) {
          storageErrors += 1;
          this.logger?.warn(
            { imageId: img.id, storageKey: img.storageKey, err },
            'Retention failed to delete storage object; preserving DB row for retry',
          );
          continue;
        }
      }

      await this.prisma.answerImage.update({
        where: { id: img.id },
        data: { deletedAt: now },
      });

      await this.prisma.auditLog.create({
        data: {
          actorType,
          actorId,
          action,
          entity: 'AnswerImage',
          entityId: img.id,
          diff: { storageKey: img.storageKey, purgedAt: now.toISOString() },
          ipHash,
        },
      });
      deleted += 1;
    }

    return { deleted, storageErrors };
  }

  private async collectActiveImagesForStudents(
    studentIds: string[],
  ): Promise<Array<{ id: string; storageKey: string }>> {
    if (studentIds.length === 0) return [];
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId: { in: studentIds } },
    });
    const attemptIds = attempts.map((a) => a.id);
    if (attemptIds.length === 0) return [];
    const answers = await this.prisma.answer.findMany({
      where: { attemptId: { in: attemptIds } },
    });
    const answerIds = answers.map((a) => a.id);
    if (answerIds.length === 0) return [];
    return this.prisma.answerImage.findMany({
      where: { answerId: { in: answerIds }, deletedAt: null },
    });
  }

  /**
   * Purges non-pinned student answer images older than RETENTION_DAYS
   * after their parent attempt reached FINAL status.
   */
  async purgeExpiredImages(now = new Date()): Promise<RetentionRunSummary> {
    const cutoff = new Date(now.getTime() - this.env.RETENTION_DAYS * 86_400_000);
    const activeImages = await this.prisma.answerImage.findMany({
      where: { deletedAt: null, pinnedByTeacher: false },
      include: {
        answer: {
          include: { attempt: true },
        },
      },
    });

    const eligible: Array<{ id: string; storageKey: string }> = [];
    for (const img of activeImages) {
      const attempt = img.answer?.attempt;
      if (!attempt || attempt.status !== 'FINAL') continue;
      const settledAt = attempt.submittedAt ?? attempt.updatedAt ?? img.createdAt;
      if (settledAt < cutoff) {
        eligible.push({ id: img.id, storageKey: img.storageKey });
      }
    }

    const { deleted, storageErrors } = await this.purgeImageBatch(
      eligible,
      'SYSTEM',
      'retention-worker',
      'RETENTION_PURGE',
      now,
      hashIp('system', this.env.IP_HASH_SALT),
    );

    await this.purgeExpiredPdfImports(now);

    return {
      scanned: activeImages.length,
      deleted,
      skippedActiveOrPinned: activeImages.length - eligible.length,
      storageErrors,
      cutoffIso: cutoff.toISOString(),
    };
  }

  /** Deletes expired PDF import artifacts (raw PDFs + rendered preview pages) and DB jobs. */
  async purgeExpiredPdfImports(
    now = new Date(),
  ): Promise<{ deletedJobs: number; storageErrors: number }> {
    const expiredJobs = await this.prisma.pdfImportJob.findMany({
      where: { expiresAt: { lt: now } },
    });
    let deletedJobs = 0;
    let storageErrors = 0;

    for (const job of expiredJobs) {
      const keys = extractStorageKeysFromJob(job);
      for (const key of keys) {
        try {
          await this.storage.deleteObject(key);
        } catch (err) {
          if (!isMissingObjectError(err)) {
            storageErrors += 1;
            this.logger?.warn({ jobId: job.id, key, err }, 'Failed to purge PDF import object');
          }
        }
      }
      await this.prisma.pdfImportJob.deleteMany({ where: { id: job.id } });
      deletedJobs += 1;
    }

    return { deletedJobs, storageErrors };
  }

  /**
   * Erases a student's uploaded photos and anonymizes their student record
   * ("delete my data" privacy action).
   */
  async deleteStudentData(
    studentId: string,
    ip?: string,
  ): Promise<{ deleted: boolean; imagesRemoved: number }> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
    });
    if (!student) {
      throw new AppError('NOT_FOUND');
    }

    const images = await this.collectActiveImagesForStudents([studentId]);

    const now = new Date();
    const ipHash = hashIp(ip, this.env.IP_HASH_SALT);
    const { deleted: imagesRemoved } = await this.purgeImageBatch(
      images,
      'STUDENT',
      studentId,
      'STUDENT_DELETE_IMAGE',
      now,
      ipHash,
    );

    await this.prisma.student.update({
      where: { id: studentId },
      data: { displayName: '[محذوف]', deletedAt: now },
    });

    await this.prisma.auditLog.create({
      data: {
        actorType: 'STUDENT',
        actorId: studentId,
        action: 'STUDENT_DELETE_DATA',
        entity: 'Student',
        entityId: studentId,
        diff: { imagesRemoved },
        ipHash,
      },
    });

    return { deleted: true, imagesRemoved };
  }

  /**
   * Erases all students' personal records and uploaded answer images for a teacher-owned cohort.
   */
  async deleteCohortData(
    teacherId: string,
    cohortId: string,
    ip?: string,
  ): Promise<{
    deleted: boolean;
    cohortId: string;
    studentsRemoved: number;
    imagesRemoved: number;
  }> {
    const cohort = await this.prisma.cohort.findFirst({
      where: { id: cohortId, ...scopedCohortWhere(teacherId) },
    });
    if (!cohort) {
      throw new AppError('NOT_FOUND');
    }

    const students = await this.prisma.student.findMany({
      where: { cohortId: cohort.id, deletedAt: null },
    });
    const images = await this.collectActiveImagesForStudents(students.map((s) => s.id));

    const now = new Date();
    const ipHash = hashIp(ip, this.env.IP_HASH_SALT);
    const { deleted: imagesRemoved } = await this.purgeImageBatch(
      images,
      'TEACHER',
      teacherId,
      'COHORT_DELETE_IMAGE',
      now,
      ipHash,
    );

    for (const st of students) {
      await this.prisma.student.update({
        where: { id: st.id },
        data: { displayName: '[محذوف]', deletedAt: now },
      });
    }

    await this.prisma.cohort.update({
      where: { id: cohort.id },
      data: { status: 'ARCHIVED' },
    });

    await this.prisma.auditLog.create({
      data: {
        actorType: 'TEACHER',
        actorId: teacherId,
        action: 'COHORT_DELETE_DATA',
        entity: 'Cohort',
        entityId: cohort.id,
        diff: { studentsRemoved: students.length, imagesRemoved },
        ipHash,
      },
    });

    return {
      deleted: true,
      cohortId: cohort.id,
      studentsRemoved: students.length,
      imagesRemoved,
    };
  }
}
