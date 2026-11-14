import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'RATE_LIMITED',
  'POSTTEST_LOCKED',
  'INVALID_CREDENTIALS',
  'EMAIL_ALREADY_REGISTERED',
  'NO_ACTIVE_QUIZ_SELECTED',
  'INVALID_COHORT_CODE',
  'COHORT_CLOSED',
  'INVALID_RESUME_CODE',
  'CONSENT_REQUIRED',
  'EXAM_DEADLINE_EXPIRED',
  'ALREADY_SUBMITTED',
  'INVALID_UPLOAD',
  'IMAGE_LIMIT_EXCEEDED',
  'IMAGE_REJECTED_QUALITY',
  'RUBRIC_SUM_MISMATCH',
  'PUBLISH_CHECKLIST_FAILED',
  'PDF_INVALID',
  'PDF_TOO_LARGE',
  'PDF_TOO_MANY_PAGES',
  'PDF_EXTRACTION_FAILED',
  'AI_UNAVAILABLE',
  'AI_CAP_EXCEEDED',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_CATALOG: Record<
  ErrorCode,
  { status: number; message_ar: string; message_en: string }
> = {
  UNAUTHORIZED: {
    status: 401,
    message_ar: 'يجب تسجيل الدخول للمتابعة.',
    message_en: 'Authentication is required.',
  },
  FORBIDDEN: {
    status: 403,
    message_ar: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
    message_en: 'You do not have permission to perform this action.',
  },
  NOT_FOUND: {
    status: 404,
    message_ar: 'العنصر المطلوب غير موجود.',
    message_en: 'Requested resource was not found.',
  },
  VALIDATION_ERROR: {
    status: 400,
    message_ar: 'البيانات المدخلة غير صالحة. يرجى المراجعة والمحاولة مجدداً.',
    message_en: 'Request validation failed.',
  },
  CONFLICT: {
    status: 409,
    message_ar: 'يوجد تعارض مع الحالة الحالية للبيانات.',
    message_en: 'Resource state conflict.',
  },
  RATE_LIMITED: {
    status: 429,
    message_ar: 'محاولات كثيرة في وقت قصير. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.',
    message_en: 'Too many requests. Please try again later.',
  },
  POSTTEST_LOCKED: {
    status: 403,
    message_ar: 'النموذج الثاني مغلق حالياً حتى استيفاء شروط الفتح.',
    message_en: 'Post-test is currently locked.',
  },
  INVALID_CREDENTIALS: {
    status: 401,
    message_ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    message_en: 'Invalid email or password.',
  },
  EMAIL_ALREADY_REGISTERED: {
    status: 409,
    message_ar: 'هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول إلى حسابك.',
    message_en: 'An account with this email already exists. Please log in.',
  },
  NO_ACTIVE_QUIZ_SELECTED: {
    status: 400,
    message_ar: 'يرجى إدخال كود الاختبار أو اختيار اختبار من حسابك أولاً.',
    message_en: 'Please enter a quiz code or select an active quiz from your account first.',
  },
  INVALID_COHORT_CODE: {
    status: 404,
    message_ar: 'كود المجموعة غير صحيح أو غير موجود.',
    message_en: 'Cohort join code is invalid.',
  },
  COHORT_CLOSED: {
    status: 403,
    message_ar: 'تم إغلاق التسجيل لهذه المجموعة من قبل المدرس.',
    message_en: 'This cohort is currently closed.',
  },
  INVALID_RESUME_CODE: {
    status: 401,
    message_ar: 'كود الاسترجاع غير صحيح.',
    message_en: 'Invalid student resume code.',
  },
  CONSENT_REQUIRED: {
    status: 403,
    message_ar: 'يجب الموافقة على إشعار الخصوصية قبل بدء الاختبار.',
    message_en: 'Consent acceptance is required before starting.',
  },
  EXAM_DEADLINE_EXPIRED: {
    status: 409,
    message_ar: 'انتهى الوقت المحدد للاختبار.',
    message_en: 'Exam deadline has expired.',
  },
  ALREADY_SUBMITTED: {
    status: 409,
    message_ar: 'تم تسليم هذا الاختبار بالفعل.',
    message_en: 'This attempt has already been submitted.',
  },
  INVALID_UPLOAD: {
    status: 400,
    message_ar: 'ملف الصورة غير صالح أو يتجاوز الحد المسموح به.',
    message_en: 'Invalid uploaded image file.',
  },
  IMAGE_LIMIT_EXCEEDED: {
    status: 400,
    message_ar: 'يمكنك رفع صورتين بحد أقصى لكل سؤال مقالي.',
    message_en: 'Maximum number of images per essay question exceeded.',
  },
  IMAGE_REJECTED_QUALITY: {
    status: 422,
    message_ar: 'الصورة غير واضحة أو فارغة. يرجى إعادة التصوير في إضاءة جيدة.',
    message_en: 'Image is too blurry or blank.',
  },
  RUBRIC_SUM_MISMATCH: {
    status: 400,
    message_ar: 'مجموع درجات بنود التصحيح يجب أن يساوي الدرجة الكلية للسؤال.',
    message_en: 'Sum of rubric criteria must equal question points.',
  },
  PUBLISH_CHECKLIST_FAILED: {
    status: 400,
    message_ar: 'النموذج غير مكتمل ولا يمكن نشره بعد. راجع قائمة التحقق.',
    message_en: 'Exam failed publish checklist requirements.',
  },
  PDF_INVALID: {
    status: 400,
    message_ar: 'الملف المرفوع ليس ملف PDF صالحاً.',
    message_en: 'Uploaded file is not a valid PDF.',
  },
  PDF_TOO_LARGE: {
    status: 413,
    message_ar: 'حجم ملف PDF يتجاوز الحد المسموح به.',
    message_en: 'PDF file exceeds maximum allowed size.',
  },
  PDF_TOO_MANY_PAGES: {
    status: 422,
    message_ar: 'عدد صفحات ملف PDF يتجاوز الحد الأقصى المسموح به.',
    message_en: 'PDF page count exceeds maximum allowed pages.',
  },
  PDF_EXTRACTION_FAILED: {
    status: 502,
    message_ar: 'تعذر استخراج الأسئلة من ملف PDF. يرجى التحقق من وضوح الملف والمحاولة مجدداً.',
    message_en: 'Failed to extract questions and answers from PDF.',
  },
  AI_UNAVAILABLE: {
    status: 503,
    message_ar: 'خدمة التصحيح الآلي متوقفة مؤقتاً. تم حفظ إجابتك للمراجعة.',
    message_en: 'AI grading service is temporarily unavailable.',
  },
  AI_CAP_EXCEEDED: {
    status: 429,
    message_ar: 'تم تجاوز الحد اليومي لخدمة التصحيح الآلي.',
    message_en: 'Daily AI usage cap exceeded.',
  },
  INTERNAL_ERROR: {
    status: 500,
    message_ar: 'حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً.',
    message_en: 'An internal server error occurred.',
  },
};

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message_ar: z.string(),
    message_en: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
