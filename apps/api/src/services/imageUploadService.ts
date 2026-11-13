import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import type { AppEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { writeAuditLog } from '../lib/scoping.js';
import { sha256Hex } from '../lib/security.js';
import type { StorageAdapter, VirusScanner } from './storage/index.js';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface UploadedImageResult {
  id: string;
  answerId: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  signedUrl: string;
}

export class ImageUploadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageAdapter,
    private readonly virusScanner: VirusScanner,
  ) {}

  async uploadAnswerImage(params: {
    studentId: string;
    answerId: string;
    fileBuffer: Buffer;
    ip?: string;
  }): Promise<UploadedImageResult> {
    const { studentId, answerId, fileBuffer, ip } = params;

    if (!fileBuffer || fileBuffer.length === 0 || fileBuffer.length > this.env.MAX_IMAGE_BYTES) {
      throw new AppError('INVALID_UPLOAD');
    }

    const answer = await this.prisma.answer.findFirst({
      where: {
        id: answerId,
        attempt: { studentId },
      },
      include: {
        attempt: true,
        question: { select: { type: true } },
        images: { where: { deletedAt: null } },
      },
    });

    if (!answer) {
      throw new AppError('NOT_FOUND');
    }

    if (answer.attempt.status !== 'IN_PROGRESS') {
      throw new AppError('ALREADY_SUBMITTED');
    }

    if (Date.now() > answer.attempt.deadlineAt.getTime()) {
      throw new AppError('EXAM_DEADLINE_EXPIRED');
    }

    if (answer.question.type !== 'ESSAY') {
      throw new AppError('VALIDATION_ERROR', {
        messageEn: 'Images can only be uploaded for essay questions.',
        messageAr: 'يمكن رفع الصور للأسئلة المقالية فقط.',
      });
    }

    if (answer.images.length >= this.env.MAX_IMAGES_PER_ANSWER) {
      throw new AppError('IMAGE_LIMIT_EXCEEDED');
    }

    const detected = await fileTypeFromBuffer(fileBuffer);
    if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
      throw new AppError('INVALID_UPLOAD');
    }

    const scanResult = await this.virusScanner.scan(fileBuffer);
    if (!scanResult.clean) {
      throw new AppError('INVALID_UPLOAD', {
        messageEn: 'File failed security scan.',
        messageAr: 'تم رفض الملف أثناء الفحص الأمني.',
      });
    }

    let normalizedBuffer: Buffer;
    let width: number;
    let height: number;
    try {
      // .rotate() honors EXIF orientation, then sharp strips all EXIF/GPS metadata by default.
      const processed = await sharp(fileBuffer)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer({ resolveWithObject: true });

      normalizedBuffer = processed.data;
      width = processed.info.width;
      height = processed.info.height;
    } catch {
      throw new AppError('INVALID_UPLOAD');
    }

    if (!width || !height || normalizedBuffer.length === 0) {
      throw new AppError('INVALID_UPLOAD');
    }

    const sha256 = sha256Hex(normalizedBuffer);
    const storageKey = `attempts/${answer.attemptId}/${answer.id}/${crypto.randomUUID()}.jpg`;
    await this.storage.putObject(storageKey, normalizedBuffer, 'image/jpeg');

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.answerImage.create({
        data: {
          answerId: answer.id,
          storageKey,
          sha256,
          width,
          height,
          bytes: normalizedBuffer.length,
        },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: studentId,
        action: 'ANSWER_IMAGE_UPLOAD',
        entity: 'AnswerImage',
        entityId: created.id,
        diff: { answerId: answer.id, bytes: created.bytes, width, height },
        ip,
      });

      return created;
    });

    const signedUrl = await this.storage.getSignedUrl(storageKey, 300);

    return {
      id: record.id,
      answerId: record.answerId,
      width: record.width,
      height: record.height,
      bytes: record.bytes,
      sha256: record.sha256,
      signedUrl,
    };
  }

  async deleteAnswerImage(params: {
    studentId: string;
    imageId: string;
    ip?: string;
  }): Promise<void> {
    const { studentId, imageId, ip } = params;

    const existing = await this.prisma.answerImage.findFirst({
      where: {
        id: imageId,
        deletedAt: null,
        answer: {
          attempt: { studentId },
        },
      },
      include: {
        answer: {
          include: { attempt: true },
        },
      },
    });

    if (!existing) {
      throw new AppError('NOT_FOUND');
    }

    if (existing.answer.attempt.status !== 'IN_PROGRESS') {
      throw new AppError('ALREADY_SUBMITTED');
    }

    if (Date.now() > existing.answer.attempt.deadlineAt.getTime()) {
      throw new AppError('EXAM_DEADLINE_EXPIRED');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.answerImage.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await writeAuditLog(tx, this.env, {
        actorType: 'STUDENT',
        actorId: studentId,
        action: 'ANSWER_IMAGE_DELETE',
        entity: 'AnswerImage',
        entityId: existing.id,
        ip,
      });
    });

    await this.storage.deleteObject(existing.storageKey);
  }
}
