import { ERROR_CATALOG, type ErrorCode } from '@mathlens/shared';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly messageAr: string;
  public readonly messageEn: string;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    overrides?: {
      statusCode?: number;
      messageAr?: string;
      messageEn?: string;
      details?: unknown;
    },
  ) {
    const entry = ERROR_CATALOG[code];
    const messageEn = overrides?.messageEn ?? entry.message_en;
    super(messageEn);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = overrides?.statusCode ?? entry.status;
    this.messageAr = overrides?.messageAr ?? entry.message_ar;
    this.messageEn = messageEn;
    this.details = overrides?.details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message_ar: this.messageAr,
        message_en: this.messageEn,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
