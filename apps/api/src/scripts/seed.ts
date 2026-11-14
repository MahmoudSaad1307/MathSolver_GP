import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SeedTopicBundleSchema, type SeedTopicBundle } from '@mathlens/shared';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { getPrisma } from '../lib/prisma.js';
import { hashPassword, signVideoUnlock } from '../lib/security.js';
import { ExamImportExportService } from '../services/examImportExportService.js';

const TOPIC_2_BUNDLE: SeedTopicBundle = {
  topic: {
    title: 'تطبيقات التفاضل: القيم القصوى ومعدلات التغير المرتبطة',
    description:
      'اختبار قبلي وبعدي يتناول إيجاد النقاط الحرجة، واختبار المشتقة الأولى والثانية للقيم القصوى المحلية والمطلقة، ومسائل معدلات التغير المرتبطة بالزمن.',
    videoUrl: 'https://www.youtube.com/watch?v=1Q1D7B7Y1uQ',
    minWatchSeconds: 240,
    correctnessThreshold: 0.6,
  },
  models: [
    {
      modelNumber: 1,
      title: 'النموذج الأول — الاختبار القبلي: القيم القصوى ومعدلات التغير',
      durationMinutes: 45,
      status: 'DRAFT',
      questions: [
        {
          orderIndex: 1,
          conceptKey: 'critical-points-poly',
          type: 'MCQ',
          promptLatex: 'Find the critical numbers of $f(x) = x^{3} - 6x^{2} + 9x + 2$.',
          points: 10,
          videoTimestampSeconds: 60,
          needsTeacherConfirmation: false,
          mcqOptions: [
            { label: 'A', textLatex: '$x = 1 \\text{ and } x = 3$', isCorrect: true },
            { label: 'B', textLatex: '$x = -1 \\text{ and } x = -3$', isCorrect: false },
            { label: 'C', textLatex: '$x = 0 \\text{ and } x = 2$', isCorrect: false },
            { label: 'D', textLatex: '$x = 2 \\text{ only}$', isCorrect: false },
          ],
        },
        {
          orderIndex: 2,
          conceptKey: 'related-rates-circle',
          type: 'ESSAY',
          promptLatex:
            'The radius $r$ of a circle is increasing at a rate of $3\\text{ cm/s}$. Find the rate at which the area $A = \\pi r^{2}$ is increasing when $r = 5\\text{ cm}$.',
          points: 15,
          videoTimestampSeconds: 140,
          needsTeacherConfirmation: true,
          modelAnswer: {
            solutionStepsLatex: [
              'A = \\pi r^{2}',
              '\\frac{dA}{dt} = 2\\pi r \\frac{dr}{dt}',
              '\\left.\\frac{dA}{dt}\\right|_{r=5} = 2\\pi (5)(3) = 30\\pi\\text{ cm}^{2}\\text{/s}',
            ],
            finalAnswerLatex: '30\\pi',
            finalAnswerSympy: '30*pi',
            commonMistakes:
              'التعويض عن نصف القطر r = 5 قبل الاشتقاق بالنسبة للزمن t، أو نسيان ضرب المشتقة في معدل تغير نصف القطر dr/dt.',
          },
          rubricCriteria: [
            {
              orderIndex: 1,
              key: 'implicit-time-derivative',
              descriptionEn: 'Differentiates A = pi*r^2 implicitly with respect to t',
              descriptionAr: 'اشتقاق علاقة المساحة ضمنياً بالنسبة للزمن t وتطبيق قاعدة السلسلة',
              maxPoints: 8,
            },
            {
              orderIndex: 2,
              key: 'substitute-and-compute',
              descriptionEn: 'Substitutes r = 5 and dr/dt = 3 to get 30*pi',
              descriptionAr: 'التعويض عن r = 5 و dr/dt = 3 وحساب الناتج النهائي 30π',
              maxPoints: 7,
            },
          ],
        },
      ],
    },
    {
      modelNumber: 2,
      title: 'النموذج الثاني — الاختبار البعدي: القيم القصوى ومعدلات التغير',
      durationMinutes: 45,
      status: 'DRAFT',
      questions: [
        {
          orderIndex: 1,
          conceptKey: 'critical-points-poly',
          type: 'MCQ',
          promptLatex: 'Find the critical numbers of $f(x) = x^{3} - 3x^{2} - 9x + 5$.',
          points: 10,
          videoTimestampSeconds: 60,
          needsTeacherConfirmation: false,
          mcqOptions: [
            { label: 'A', textLatex: '$x = -1 \\text{ and } x = 3$', isCorrect: true },
            { label: 'B', textLatex: '$x = 1 \\text{ and } x = -3$', isCorrect: false },
            { label: 'C', textLatex: '$x = 0 \\text{ and } x = 3$', isCorrect: false },
            { label: 'D', textLatex: '$x = 1 \\text{ only}$', isCorrect: false },
          ],
        },
        {
          orderIndex: 2,
          conceptKey: 'related-rates-circle',
          type: 'ESSAY',
          promptLatex:
            'The radius $r$ of a circle is increasing at a rate of $2\\text{ cm/s}$. Find the rate at which the area $A = \\pi r^{2}$ is increasing when $r = 7\\text{ cm}$.',
          points: 15,
          videoTimestampSeconds: 140,
          needsTeacherConfirmation: true,
          modelAnswer: {
            solutionStepsLatex: [
              'A = \\pi r^{2}',
              '\\frac{dA}{dt} = 2\\pi r \\frac{dr}{dt}',
              '\\left.\\frac{dA}{dt}\\right|_{r=7} = 2\\pi (7)(2) = 28\\pi\\text{ cm}^{2}\\text{/s}',
            ],
            finalAnswerLatex: '28\\pi',
            finalAnswerSympy: '28*pi',
            commonMistakes:
              'نسيان معامل dr/dt عند اشتقاق r^2 بالنسبة للزمن t، أو استخدام محيط الدائرة بدلاً من المشتقة الزمنية.',
          },
          rubricCriteria: [
            {
              orderIndex: 1,
              key: 'implicit-time-derivative',
              descriptionEn: 'Differentiates A = pi*r^2 implicitly with respect to t',
              descriptionAr: 'اشتقاق علاقة المساحة ضمنياً بالنسبة للزمن t وتطبيق قاعدة السلسلة',
              maxPoints: 8,
            },
            {
              orderIndex: 2,
              key: 'substitute-and-compute',
              descriptionEn: 'Substitutes r = 7 and dr/dt = 2 to get 28*pi',
              descriptionAr: 'التعويض عن r = 7 و dr/dt = 2 وحساب الناتج النهائي 28π',
              maxPoints: 7,
            },
          ],
        },
      ],
    },
  ],
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function renderHandwrittenSheetPng(opts: {
  questionOrder: number;
  conceptKey: string;
  lines: string[];
  finalLine: string;
}): Promise<{ buffer: Buffer; sha256: string; width: number; height: number }> {
  const width = 900;
  const height = 560;
  const lineElements = opts.lines
    .map((line, idx) => {
      const y = 155 + idx * 72;
      return `<text x="95" y="${y}" font-family="Comic Sans MS, Segoe Print, Bradley Hand, monospace" font-size="26" fill="#1e3a8a">Step ${idx + 1}:  ${escapeXml(line)}</text>`;
    })
    .join('\n');

  const finalY = 155 + opts.lines.length * 72 + 20;
  const gridLines = Array.from({ length: 12 }, (_, i) => {
    const y = 90 + i * 40;
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#dbeafe" stroke-width="1.5" />`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#fffef7" />
    ${gridLines}
    <line x1="75" y1="0" x2="75" y2="${height}" stroke="#fca5a5" stroke-width="2" />
    <text x="95" y="65" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="bold" fill="#475569">
      Question #${opts.questionOrder} (${escapeXml(opts.conceptKey)}) — Handwritten Solution
    </text>
    ${lineElements}
    <rect x="90" y="${finalY - 34}" width="720" height="52" rx="8" fill="#eff6ff" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6,4" />
    <text x="108" y="${finalY}" font-family="Comic Sans MS, Segoe Print, Bradley Hand, monospace" font-size="27" font-weight="bold" fill="#0f172a">
      Final Answer:  ${escapeXml(opts.finalLine)}
    </text>
  </svg>`;

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, sha256, width, height };
}

async function writeStorageFileToBothDirs(
  storageKey: string,
  buffer: Buffer,
  repoRoot: string,
): Promise<void> {
  const cleanKey = storageKey.replace(/^\/+/, '');
  const targets = [
    path.resolve(repoRoot, 'storage-dev', cleanKey),
    path.resolve(repoRoot, 'apps/api/storage-dev', cleanKey),
  ];
  for (const target of targets) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  }
}

interface EssaySampleData {
  fullSteps: string[];
  partialSteps: string[];
  finalCorrect: string;
  finalWrong: string;
  explanationFullAr: string;
  explanationPartialAr: string;
  hintAr: string;
  criteriaCommentsFullAr: string[];
  criteriaCommentsPartialAr: string[];
}

const ESSAY_SAMPLES_M1: Record<number, EssaySampleData> = {
  5: {
    fullSteps: [
      'ln(y) = x * ln(sec x)',
      "y'/y = ln(sec x) + x * (sec x tan x)/(sec x)",
      "y'/y = ln(sec x) + x * tan x",
      "y' = (sec x)^x * [ln(sec x) + x tan x]",
    ],
    partialSteps: [
      'ln(y) = x * ln(sec x)',
      "y'/y = ln(sec x) + x * tan x",
      "y' = ln(sec x) + x * tan x",
    ],
    finalCorrect: '(sec x)^x (ln(sec x) + x tan x)',
    finalWrong: 'ln(sec x) + x tan x',
    explanationFullAr:
      'حل ممتاز؛ تم أخذ اللوغاريتم الطبيعي للطرفين وتطبيق الاشتقاق الضمني وقاعدة الضرب بدقة مع الضرب في الدالة الأصلية.',
    explanationPartialAr:
      'أحسنت في أخذ اللوغاريتم الطبيعي للطرفين وتطبيق قاعدة حاصل الضرب، لكن نسيت ضرب الطرف الأيمن في y = (sec x)^x في الخطوة النهائية.',
    hintAr:
      'تذكر أنه عند اشتقاق ln(y) تحصل على y\'/y، لذا يجب ضرب الناتج النهائي في y = (sec x)^x.',
    criteriaCommentsFullAr: [
      'تم أخذ اللوغاريتم الطبيعي للطرفين وإنزال الأس x بشكل صحيح.',
      'تم اشتقاق ln(y) ضمنياً إلى y\'/y بدقة.',
      'تطبيق سليم لقاعدة حاصل الضرب على x ln(sec x).',
      'تبسيط صحيح لمشتقة ln(sec x) إلى tan x.',
      'تم الضرب في y = (sec x)^x وكتابة الصورة النهائية.',
    ],
    criteriaCommentsPartialAr: [
      'تم أخذ اللوغاريتم الطبيعي للطرفين وإنزال الأس x بشكل صحيح.',
      'تم اشتقاق الطرف الأيسر ضمنياً.',
      'تطبيق صحيح لقاعدة حاصل الضرب.',
      'تبسيط سليم لمشتقة ln(sec x) إلى tan x.',
      'لم يتم ضرب الناتج في y = (sec x)^x في الخطوة الأخيرة.',
    ],
  },
  6: {
    fullSteps: [
      'dy/dx = (d/dx)(e^(2x)) cos x + e^(2x) (d/dx)(cos x)',
      'dy/dx = 2 e^(2x) cos x - e^(2x) sin x = e^(2x)(2 cos x - sin x)',
      'dy/dx at x=0 = e^0 (2 cos(0) - sin(0)) = 1 * (2 - 0) = 2',
    ],
    partialSteps: [
      'dy/dx = e^(2x) cos x - e^(2x) sin x',
      'dy/dx at x=0 = e^0 (cos(0) - sin(0)) = 1',
    ],
    finalCorrect: '2',
    finalWrong: '1',
    explanationFullAr:
      'إجابة كاملة؛ طبقت قاعدة حاصل الضرب وقاعدة السلسلة على e^(2x) بشكل سليم وعوضت عند x = 0 بدقة.',
    explanationPartialAr:
      'طبقت قاعدة حاصل الضرب بشكل جيد، لكن نسيت ضرب مشتقة e^(2x) في معامل الأس (2) حسب قاعدة السلسلة مما أدى إلى ناتج عددي يساوي 1 بدلاً من 2.',
    hintAr: 'مشتقة e^(2x) هي 2e^(2x) وليست e^(2x)؛ راجع تطبيق قاعدة السلسلة قبل التعويض عن x = 0.',
    criteriaCommentsFullAr: [
      'كتابة قاعدة مشتقة حاصل الضرب بحديها بشكل صحيح.',
      'تطبيق قاعدة السلسلة لاشتقاق e^(2x) إلى 2e^(2x).',
      'الوصول للصيغة المبسطة الصحيحة للمشتقة.',
      'تعويض سليم عن x = 0.',
      'حساب القيمة العددية النهائية 2 بدقة.',
    ],
    criteriaCommentsPartialAr: [
      'كتابة هيكل قاعدة حاصل الضرب بشكل صحيح.',
      'نقص معامل 2 عند اشتقاق e^(2x) بقاعدة السلسلة.',
      'صيغة المشتقة ينقصها المعامل 2.',
      'تم التعويض عن x = 0 في التعبير المستنتج.',
      'الناتج العددي النهائي غير دقيق بسبب خطأ قاعدة السلسلة.',
    ],
  },
  7: {
    fullSteps: [
      'y = 3 ln(x)  =>  dy/dx = 3/x',
      'At x = 1: slope m = 3/1 = 3, point (1, ln(1)) = (1, 0)',
      'Tangent line: y - 0 = 3(x - 1)  =>  y = 3x - 3',
      'Intercepts: x-axis (1, 0), y-axis (0, -3)',
      'd = sqrt((1 - 0)^2 + (0 - (-3))^2) = sqrt(1 + 9) = sqrt(10)',
    ],
    partialSteps: [
      'y = 3 ln(x)  =>  dy/dx = 3/x, slope m = 3 at (1, 0)',
      'Tangent line: y = 3x - 3',
      'Intercepts: (1, 0) and (0, -3)',
      'd = sqrt(1^2 + 3) = 2',
    ],
    finalCorrect: 'sqrt(10)',
    finalWrong: '2',
    explanationFullAr:
      'خطوات متسلسلة وصحيحة بالكامل في إيجاد المشتقة ومعادلة المماس ونقطتي التقاطع وحساب المسافة بينهما.',
    explanationPartialAr:
      'أوجدت معادلة المماس y = 3x - 3 ونقطتي التقاطع (1,0) و (0,-3) بشكل صحيح، لكن حدث خطأ حسابي أثناء تربيع الإحداثي الصادي في قانون المسافة.',
    hintAr: 'عند تطبيق قانون البعد بين النقطتين (1,0) و (0,-3)، ربع العدد (-3) ليصبح 9 فيكون المجموع تحت الجذر 1 + 9 = 10.',
    criteriaCommentsFullAr: [
      'إيجاد المشتقة y\' = 3/x وحساب الميل m = 3 عند x = 1.',
      'إيجاد نقطة التماس (1, 0) بشكل سليم.',
      'كتابة معادلة المماس y = 3x - 3 بدقة.',
      'تحديد نقطتي التقاطع مع المحورين (1, 0) و (0, -3).',
      'تطبيق قانون المسافة والوصول إلى الجذر التربيعي لـ 10.',
    ],
    criteriaCommentsPartialAr: [
      'إيجاد المشتقة y\' = 3/x وحساب الميل m = 3.',
      'تحديد نقطة التماس (1, 0).',
      'كتابة معادلة المماس y = 3x - 3.',
      'إيجاد نقطتي التقاطع (1, 0) و (0, -3).',
      'خطأ في تربيع (-3) داخل قانون البعد بين نقطتين.',
    ],
  },
  8: {
    fullSteps: [
      'Error 1: e^4 is a constant term, so d/dx(e^4) = 0, not 4e^3.',
      'Error 2: d/dx(2^x) = 2^x ln(2), the student omitted the factor ln(2).',
      'Correct derivative: dy/dx = 2^x ln(2)',
    ],
    partialSteps: [
      'Error 1: e^4 is a constant so its derivative is 0.',
      'Correct derivative: dy/dx = 2^x',
    ],
    finalCorrect: '2^x ln 2',
    finalWrong: '2^x',
    explanationFullAr:
      'اكتشفت الخطأين بدقة (كون e^4 ثابتاً وضرورة ضرب مشتقة 2^x في ln 2) وكتبت المشتقة النهائية الصحيحة.',
    explanationPartialAr:
      'حددت الخطأ الأول بنجاح (مشتقة الثابت e^4 تساوي صفراً)، لكن لم تشر إلى نقص المعامل ln(2) في مشتقة الدالة الأسية 2^x.',
    hintAr: 'تذكر أن مشتقة الدالة الأسية ذات الأساس العام a^x هي a^x ln(a).',
    criteriaCommentsFullAr: [
      'تحديد أن e^4 ثابت ومشتقته تساوي صفراً.',
      'تحديد نقص المعامل ln(2) عند اشتقاق 2^x.',
      'كتابة المشتقة الصحيحة y\' = 2^x ln 2.',
    ],
    criteriaCommentsPartialAr: [
      'تحديد أن e^4 ثابت ومشتقته تساوي صفراً.',
      'لم يتم ذكر نقص المعامل ln(2) في مشتقة 2^x.',
      'المشتقة المكتوبة ينقصها المعامل ln(2).',
    ],
  },
  9: {
    fullSteps: [
      "P'(t) = 200(0.04)e^(0.04t) = 8e^(0.04t) = 0.04 P(t)",
      "Q'(t) = 8",
      'P(t) grows exponentially (rate proportional to current size P), whereas Q(t) grows linearly at a constant rate of 8.',
    ],
    partialSteps: [
      "P'(t) = 8e^(0.04t)",
      "Q'(t) = 8",
      'P grows faster than Q.',
    ],
    finalCorrect: "P'(t)=8e^{0.04t}=0.04P, Q'(t)=8",
    finalWrong: "P'(t)=8e^{0.04t}, Q'(t)=8",
    explanationFullAr:
      'حل نموذجي؛ أوجدت المشتقتين وربطت P\'(t) بحجم المجتمع P(t) مع تفسير علمي واضح للفرق بين النمو الأسي والنمو الخطي.',
    explanationPartialAr:
      'أوجدت المشتقتين P\'(t) و Q\'(t) بشكل صحيح، لكن لم تعبر عن P\'(t) بدلالة P(t) ولم تفصل الفرق بين معدل التغير المتناسب والمعدل الثابت.',
    hintAr: 'عبر عن 8e^(0.04t) على الصورة 0.04P(t) لتوضيح أن معدل النمو الأسي يتناسب طردياً مع الحجم الحالي.',
    criteriaCommentsFullAr: [
      'إيجاد المشتقة P\'(t) = 8e^(0.04t) بشكل صحيح.',
      'كتابة P\'(t) = 0.04P(t) بدلالة P.',
      'إيجاد المشتقة Q\'(t) = 8 بشكل صحيح.',
      'تصنيف P كنمو أسي و Q كنمو خطي.',
      'توضيح الفرق بين معدل النمو المتناسب مع الحجم والمعدل الثابت.',
    ],
    criteriaCommentsPartialAr: [
      'إيجاد المشتقة P\'(t) = 8e^(0.04t) بشكل صحيح.',
      'لم يتم كتابة P\'(t) بدلالة P(t).',
      'إيجاد المشتقة Q\'(t) = 8 بشكل صحيح.',
      'إشارة مختصرة لنوع النمو دون تفصيل كامل.',
      'التفسير يحتاج لتوضيح التناسب الطردي مقابل الثبات.',
    ],
  },
  10: {
    fullSteps: [
      'x^2 - 4x + 3 > 0  =>  (x - 1)(x - 3) > 0',
      'Domain of f: (-inf, 1) U (3, inf)',
      'At x = 2: 2^2 - 4(2) + 3 = -1 < 0, so x = 2 is NOT in the domain.',
      'Therefore x = 2 is invalid and f has no critical points.',
    ],
    partialSteps: [
      'x^2 - 4x + 3 > 0  =>  x != 1, x != 3',
      'At x = 2, f(2) = ln(-1) which is undefined.',
      'So x = 2 is not a critical point.',
    ],
    finalCorrect: 'Domain (-inf,1) U (3,inf); x=2 is invalid',
    finalWrong: 'x=2 is undefined',
    explanationFullAr:
      'إجابة متقنة؛ حددت فترة المجال الصحيحة وأثبتت عدم انتماء x = 2 للمجال وبالتالي عدم وجود نقاط حرجة.',
    explanationPartialAr:
      'تنبهت إلى أن تعويض x = 2 يجعل ما داخل اللوغاريتم سالباً (-1)، لكن لم تكتب فترات المجال (-∞, 1) ∪ (3, ∞) بشكل كامل.',
    hintAr: 'حل المتباينة التربيعية (x - 1)(x - 3) > 0 بتحديد إشارة المقدار على خط الأعداد لكتابة المجال على صورة اتحاد فترتين.',
    criteriaCommentsFullAr: [
      'كتابة شرط المجال x^2 - 4x + 3 > 0.',
      'حل المتباينة للحصول على المجال (-∞, 1) ∪ (3, ∞).',
      'إثبات أن x = 2 لا ينتمي للمجال لأن ما داخل اللوغاريتم يساوي -1.',
      'توضيح أن النقطة الحرجة يجب أن تنتمي إلى مجال الدالة.',
      'الاستنتاج النهائي بأن x = 2 مرفوضة ولا توجد نقاط حرجة.',
    ],
    criteriaCommentsPartialAr: [
      'كتابة شرط الإيجابية لما داخل اللوغاريتم.',
      'لم يتم كتابة فترات الحل (-∞, 1) ∪ (3, ∞) بشكل دقيق.',
      'إثبات أن تعويض x = 2 يعطي ln(-1) غير المعرف.',
      'الإشارة إلى عدم صلاحية النقطة الحرجة خارج المجال.',
      'استنتاج صحيح برفض x = 2.',
    ],
  },
};

const ESSAY_SAMPLES_M2: Record<number, EssaySampleData> = {
  5: {
    fullSteps: [
      'ln(y) = x * ln(tan x)',
      "y'/y = ln(tan x) + x * (sec^2 x)/(tan x)",
      "y' = (tan x)^x * [ln(tan x) + (x sec^2 x)/(tan x)]",
    ],
    partialSteps: [
      'ln(y) = x * ln(tan x)',
      "y'/y = ln(tan x) + x / (tan x)",
      "y' = (tan x)^x * [ln(tan x) + x / (tan x)]",
    ],
    finalCorrect: '(tan x)^x (ln(tan x) + x sec^2(x) / tan x)',
    finalWrong: '(tan x)^x (ln(tan x) + x / tan x)',
    explanationFullAr:
      'إجابة صحيحة ومكتملة؛ طبقت الاشتقاق اللوغاريتمي وقاعدة الضرب ومشتقة الظل بدقة.',
    explanationPartialAr:
      'طبقت الاشتقاق اللوغاريتمي والضرب في y بشكل صحيح، لكن نسيت مشتقة ما داخل اللوغاريتم sec^2(x) عند اشتقاق ln(tan x).',
    hintAr: 'عند اشتقاق ln(tan x) بقاعدة السلسلة، اقسم مشتقة الظل sec^2(x) على tan x.',
    criteriaCommentsFullAr: [
      'أخذ اللوغاريتم الطبيعي للطرفين وإنزال الأس x.',
      'اشتقاق ln(y) ضمنياً إلى y\'/y.',
      'تطبيق قاعدة حاصل الضرب على x ln(tan x).',
      'حساب مشتقة ln(tan x) = sec^2(x)/tan x بشكل سليم.',
      'الضرب في y = (tan x)^x للحصول على الناتج النهائي.',
    ],
    criteriaCommentsPartialAr: [
      'أخذ اللوغاريتم الطبيعي للطرفين وإنزال الأس x.',
      'اشتقاق ln(y) ضمنياً إلى y\'/y.',
      'تطبيق قاعدة حاصل الضرب.',
      'نقص البسط sec^2(x) عند اشتقاق ln(tan x).',
      'تم الضرب في y = (tan x)^x في الخطوة النهائية.',
    ],
  },
  6: {
    fullSteps: [
      'dy/dx = 3 e^(3x) sin x + e^(3x) cos x = e^(3x)(3 sin x + cos x)',
      'dy/dx at x=0 = e^0 (3 sin(0) + cos(0)) = 1 * (0 + 1) = 1',
    ],
    partialSteps: [
      'dy/dx = e^(3x) sin x + e^(3x) cos x',
      'dy/dx at x=0 = e^0 (0 + 1) = 1',
    ],
    finalCorrect: '1',
    finalWrong: '1',
    explanationFullAr:
      'حل ممتاز؛ طبقت قاعدة حاصل الضرب وقاعدة السلسلة على e^(3x) وأوجدت القيمة العددية عند x = 0.',
    explanationPartialAr:
      'القيمة النهائية عند x = 0 صحيحة لأن sin(0) = 0، لكن صيغة المشتقة الأولى ينقصها المعامل 3 في الحد الأول 3e^(3x)sin x.',
    hintAr: 'انتبه لتطبيق قاعدة السلسلة عند اشتقاق e^(3x) حتى لو كان الحد ينعدم عند التعويض عن x = 0.',
    criteriaCommentsFullAr: [
      'كتابة قاعدة مشتقة حاصل الضرب بحديها بشكل صحيح.',
      'تطبيق قاعدة السلسلة لاشتقاق e^(3x) إلى 3e^(3x).',
      'الوصول للصيغة الصحيحة للمشتقة e^(3x)(3sin x + cos x).',
      'التعويض عن x = 0 في تعبير المشتقة.',
      'حساب القيمة العددية النهائية 1.',
    ],
    criteriaCommentsPartialAr: [
      'كتابة قاعدة حاصل الضرب.',
      'نقص المعامل 3 في مشتقة e^(3x).',
      'صيغة المشتقة ينقصها معامل 3 أمام sin x.',
      'تعويض سليم عن x = 0.',
      'القيمة العددية النهائية 1 صحيحة.',
    ],
  },
  7: {
    fullSteps: [
      'y = 5 ln(x)  =>  dy/dx = 5/x',
      'At x = 1: m = 5, point (1, 0)',
      'Tangent line: y = 5x - 5',
      'Intercepts: (1, 0) and (0, -5)',
      'd = sqrt((1 - 0)^2 + (0 - (-5))^2) = sqrt(1 + 25) = sqrt(26)',
    ],
    partialSteps: [
      'y = 5 ln(x)  =>  dy/dx = 5/x, m = 5 at (1, 0)',
      'Tangent line: y = 5x - 5',
      'Intercepts: (1, 0) and (0, -5)',
      'd = sqrt(1 + 5) = sqrt(6)',
    ],
    finalCorrect: 'sqrt(26)',
    finalWrong: 'sqrt(6)',
    explanationFullAr:
      'حل متكامل ودقيق لمعادلة المماس ونقطتي التقاطع والمسافة بينهما.',
    explanationPartialAr:
      'أوجدت معادلة المماس y = 5x - 5 ونقطتي التقاطع بدقة، لكن عوضت بـ 5 بدلاً من مربعها 25 داخل جذر المسافة.',
    hintAr: 'تذكر تربيع فرق الصادات (-5)^2 = 25 عند حساب المسافة.',
    criteriaCommentsFullAr: [
      'إيجاد المشتقة y\' = 5/x وحساب الميل m = 5 عند x = 1.',
      'إيجاد نقطة التماس (1, 0).',
      'كتابة معادلة المماس y = 5x - 5.',
      'إيجاد نقطتي التقاطع مع المحورين (1, 0) و (0, -5).',
      'تطبيق قانون البعد بين نقطتين للحصول على sqrt(26).',
    ],
    criteriaCommentsPartialAr: [
      'إيجاد المشتقة والميل m = 5.',
      'تحديد نقطة التماس (1, 0).',
      'كتابة معادلة المماس y = 5x - 5.',
      'إيجاد نقطتي التقاطع (1, 0) و (0, -5).',
      'خطأ حسابي في تربيع (-5) داخل قانون المسافة.',
    ],
  },
  8: {
    fullSteps: [
      'Error: 7^3 is a constant, so d/dx(7^3) = 0, not 3(7)^2.',
      'Power rule n*x^(n-1) only applies when the base is a variable.',
      'Correct derivative: dy/dx = 2e^(2x)',
    ],
    partialSteps: [
      '7^3 is a constant so its derivative is 0.',
      'dy/dx = e^(2x)',
    ],
    finalCorrect: '2e^(2x)',
    finalWrong: 'e^(2x)',
    explanationFullAr:
      'حددت الخطأ في اشتقاق الثابت 7^3 وفسرت السبب العلمي وكتبت المشتقة الصحيحة 2e^(2x).',
    explanationPartialAr:
      'حددت أن 7^3 ثابت مشتقته صفر، لكن نسيت معامل 2 عند اشتقاق الحد الثاني e^(2x).',
    hintAr: 'مشتقة e^(2x) تساوي 2e^(2x) بتطبيق قاعدة السلسلة.',
    criteriaCommentsFullAr: [
      'تحديد أن 7^3 ثابت ومشتقته تساوي صفراً.',
      'توضيح أن قاعدة القوة لا تُطبق على الأساسات الثابتة.',
      'كتابة المشتقة الصحيحة y\' = 2e^(2x).',
    ],
    criteriaCommentsPartialAr: [
      'تحديد أن 7^3 ثابت ومشتقته تساوي صفراً.',
      'توضيح مختصر للقاعدة.',
      'نسيان معامل 2 في مشتقة e^(2x).',
    ],
  },
  9: {
    fullSteps: [
      "A'(t) = 300(0.02)e^(0.02t) = 6e^(0.02t) = 0.02 A(t)",
      "B'(t) = 6",
      'A(t) grows exponentially (proportional to current amount A), while B(t) grows linearly at a constant rate 6.',
    ],
    partialSteps: [
      "A'(t) = 6e^(0.02t)",
      "B'(t) = 6",
      'A is exponential growth and B is linear growth.',
    ],
    finalCorrect: "A'(t)=6e^{0.02t}=0.02A, B'(t)=6",
    finalWrong: "A'(t)=6e^{0.02t}, B'(t)=6",
    explanationFullAr:
      'حل كامل يوضح المشتقتين والعلاقة التناسبية للنمو الأسي مقارنة بالمعدل الثابت للنمو الخطي.',
    explanationPartialAr:
      'أوجدت المشتقتين وصنفت نوع النمو، لكن ينقص الحل ربط A\'(t) = 0.02A(t) وشرح معنى التناسب الطردي.',
    hintAr: 'اكتب A\'(t) = 0.02A(t) لإبراز أن معدل التغير يتناسب مع الكمية الحالية.',
    criteriaCommentsFullAr: [
      'إيجاد المشتقة A\'(t) = 6e^(0.02t) بشكل صحيح.',
      'كتابة A\'(t) بدلالة A أي 0.02A.',
      'إيجاد المشتقة B\'(t) = 6 بشكل صحيح.',
      'تصنيف A كنمو أسي و B كنمو خطي.',
      'توضيح الفرق بين معدل النمو المتناسب مع الحجم والمعدل الثابت.',
    ],
    criteriaCommentsPartialAr: [
      'إيجاد المشتقة A\'(t) = 6e^(0.02t).',
      'لم تُكتب A\'(t) بدلالة A(t).',
      'إيجاد المشتقة B\'(t) = 6.',
      'تصنيف سليم للنمو الأسي والخطي.',
      'شرح مختصر يحتاج لتفصيل التناسب.',
    ],
  },
  10: {
    fullSteps: [
      'x^2 - 6x + 8 > 0  =>  (x - 2)(x - 4) > 0',
      'Domain: (-inf, 2) U (4, inf)',
      'At x = 3: 3^2 - 6(3) + 8 = -1 < 0, so x = 3 is outside the domain.',
      'Since a critical point must be in the domain of f, x = 3 is invalid (no critical points).',
    ],
    partialSteps: [
      'x^2 - 6x + 8 > 0',
      'For x = 3, ln(9 - 18 + 8) = ln(-1) undefined.',
      'x = 3 is not a critical point.',
    ],
    finalCorrect: 'Domain (-inf,2) U (4,inf); x=3 is invalid',
    finalWrong: 'x=3 is invalid',
    explanationFullAr:
      'إجابة ممتازة؛ أوجدت المجال الصحيح وأثبتت أن x = 3 خارج المجال واستنتجت عدم وجود نقاط حرجة.',
    explanationPartialAr:
      'أثبتت أن x = 3 تجعل ما داخل اللوغاريتم سالباً، لكن لم تكتب فترات المجال (-∞, 2) ∪ (4, ∞) كاملة.',
    hintAr: 'حل المتباينة (x - 2)(x - 4) > 0 أولاً لكتابة المجال على صورة اتحاد فترتين.',
    criteriaCommentsFullAr: [
      'كتابة شرط المجال x^2 - 6x + 8 > 0.',
      'حل المتباينة للحصول على المجال (-∞, 2) ∪ (4, ∞).',
      'إثبات أن x = 3 لا ينتمي للمجال لأن ما داخل اللوغاريتم سالب.',
      'توضيح أن النقطة الحرجة يجب أن تنتمي إلى مجال الدالة.',
      'الاستنتاج النهائي بأن x = 3 مرفوضة ولا توجد نقاط حرجة.',
    ],
    criteriaCommentsPartialAr: [
      'كتابة شرط المجال.',
      'نقص في تحديد فترات المجال (-∞, 2) ∪ (4, ∞).',
      'إثبات أن تعويض x = 3 يعطي قيمة سالبة داخل اللوغاريتم.',
      'ذكر شرط انتماء النقطة الحرجة للمجال.',
      'الاستنتاج النهائي برفض x = 3.',
    ],
  },
};

interface MockStudentSpec {
  displayName: string;
  resumeCode: string;
  cohortKey: 'EXP1' | 'CTR2' | 'EXP3';
  stage: 'COMPLETED_BOTH' | 'REMEDIATION_VIDEO' | 'NEEDS_REVIEW';
  /** Per-question quality on Model 1 (orderIndex 1..10): 'full' | 'partial' | 'wrong' */
  m1Profile: Record<number, 'full' | 'partial' | 'wrong'>;
  /** Per-question quality on Model 2 (orderIndex 1..10) if stage === 'COMPLETED_BOTH' */
  m2Profile?: Record<number, 'full' | 'partial' | 'wrong'>;
  watchedSeconds: number;
  reviewItems?: Array<{
    orderIndex: number;
    reasons: string[];
    confidence: number;
    misreadNoteAr?: string;
  }>;
  overrideItems?: Array<{
    modelNumber: 1 | 2;
    orderIndex: number;
    bonusDelta: number;
    noteAr: string;
    explanationAr: string;
  }>;
}

const MOCK_STUDENTS: MockStudentSpec[] = [
  // --- Cohort 1 (TREATMENT - EXP234): 6 paired students showing strong learning gains ---
  {
    displayName: 'عبدالله محمد العتيبي',
    resumeCode: 'ABD234',
    cohortKey: 'EXP1',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 420,
    m1Profile: {
      1: 'full',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'partial',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'full',
      8: 'full',
      9: 'partial',
      10: 'full',
    },
    overrideItems: [
      {
        modelNumber: 1,
        orderIndex: 5,
        bonusDelta: 1,
        noteAr:
          'تمت مراجعة ورقة الطالب عبد الله؛ خطوة قاعدة الضرب صحيحة تماماً وتستحق علامة إضافية.',
        explanationAr:
          'خطوات الاشتقاق الضمني وقاعدة الضرب صحيحة، وتم خصم درجة واحدة فقط لنسيان الضرب في y في السطر الأخير.',
      },
    ],
  },
  {
    displayName: 'سارة أحمد الغامدي',
    resumeCode: 'SAR235',
    cohortKey: 'EXP1',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 395,
    m1Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'full',
      8: 'full',
      9: 'full',
      10: 'full',
    },
    overrideItems: [
      {
        modelNumber: 2,
        orderIndex: 7,
        bonusDelta: 0,
        noteAr: 'تم تأكيد درجة الذكاء الاصطناعي الكاملة بعد التحقق من خطوات معادلة المماس.',
        explanationAr: 'حل نموذجي ومتكامل لجميع خطوات المماس والمسافة بين نقطتي التقاطع.',
      },
    ],
  },
  {
    displayName: 'عمر خالد الحربي',
    resumeCode: 'UMR236',
    cohortKey: 'EXP1',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 360,
    m1Profile: {
      1: 'wrong',
      2: 'full',
      3: 'wrong',
      4: 'wrong',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'partial',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'full',
      10: 'full',
    },
  },
  {
    displayName: 'مريم طارق القحطاني',
    resumeCode: 'MRY237',
    cohortKey: 'EXP1',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 410,
    m1Profile: {
      1: 'full',
      2: 'wrong',
      3: 'full',
      4: 'full',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'full',
      8: 'full',
      9: 'full',
      10: 'partial',
    },
    overrideItems: [
      {
        modelNumber: 1,
        orderIndex: 7,
        bonusDelta: 2,
        noteAr: 'الطالبة مريم كتبت نقطتي التقاطع بشكل سليم في الهامش الأيمن للصورة.',
        explanationAr: 'تم احتساب درجة إيجاد نقطتي التقاطع كاملة بعد المراجعة اليدوية للصورة.',
      },
    ],
  },
  {
    displayName: 'يوسف إبراهيم الزهراني',
    resumeCode: 'YSF238',
    cohortKey: 'EXP1',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 365,
    m1Profile: {
      1: 'wrong',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'partial',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'full',
    },
  },
  {
    displayName: 'نورة فهد الدوسري',
    resumeCode: 'NWR239',
    cohortKey: 'EXP1',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 385,
    m1Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'full',
      6: 'partial',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'full',
      8: 'full',
      9: 'full',
      10: 'partial',
    },
  },
  // --- Cohort 1 student in NEEDS_REVIEW (active in Review Queue) ---
  {
    displayName: 'خالد عبدالرحمن الشهري',
    resumeCode: 'KHD242',
    cohortKey: 'EXP1',
    stage: 'NEEDS_REVIEW',
    watchedSeconds: 120,
    m1Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'full',
    },
    reviewItems: [
      {
        orderIndex: 5,
        reasons: ['LOW_CONFIDENCE', 'STUDENT_REPORTED_MISREAD'],
        confidence: 0.64,
        misreadNoteAr:
          'الخطوة الأخيرة في ورقة الإجابة مضروبة في (sec x)^x ولكن القراءة الآلية لم تتعرف على القوس الأخير.',
      },
      {
        orderIndex: 7,
        reasons: ['SYMPY_MISMATCH'],
        confidence: 0.78,
      },
    ],
  },
  // --- Cohort 1 student at REMEDIATION_VIDEO stage ---
  {
    displayName: 'لينا سعد المالكي',
    resumeCode: 'MNA243',
    cohortKey: 'EXP1',
    stage: 'REMEDIATION_VIDEO',
    watchedSeconds: 185,
    m1Profile: {
      1: 'full',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
  },
  // --- Cohort 2 (CONTROL - CTR567): 4 paired students with modest change + 1 in NEEDS_REVIEW ---
  {
    displayName: 'فيصل سلطان العنزي',
    resumeCode: 'FYS244',
    cohortKey: 'CTR2',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 0,
    m1Profile: {
      1: 'full',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    overrideItems: [
      {
        modelNumber: 1,
        orderIndex: 8,
        bonusDelta: 0,
        noteAr: 'تمت مراجعة إجابة الطالب فيصل وتأكيد الدرجة المرصودة.',
        explanationAr: 'تحديد سليم لخطأ اشتقاق الثابت ومعامل اللوغاريتم الطبيعي.',
      },
    ],
  },
  {
    displayName: 'ريم وليد السبيعي',
    resumeCode: 'REM245',
    cohortKey: 'CTR2',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 0,
    m1Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'partial',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
  },
  {
    displayName: 'حمزة مازن الشمري',
    resumeCode: 'HMZ246',
    cohortKey: 'CTR2',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 0,
    m1Profile: {
      1: 'wrong',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'partial',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'partial',
      7: 'partial',
      8: 'partial',
      9: 'partial',
      10: 'partial',
    },
  },
  {
    displayName: 'دانة ياسر المطيري',
    resumeCode: 'DAN247',
    cohortKey: 'CTR2',
    stage: 'COMPLETED_BOTH',
    watchedSeconds: 0,
    m1Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'partial',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    m2Profile: {
      1: 'full',
      2: 'full',
      3: 'wrong',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
  },
  {
    displayName: 'طلال نايف البقمي',
    resumeCode: 'TNA248',
    cohortKey: 'CTR2',
    stage: 'NEEDS_REVIEW',
    watchedSeconds: 0,
    m1Profile: {
      1: 'full',
      2: 'wrong',
      3: 'wrong',
      4: 'full',
      5: 'full',
      6: 'partial',
      7: 'partial',
      8: 'full',
      9: 'partial',
      10: 'partial',
    },
    reviewItems: [
      {
        orderIndex: 6,
        reasons: ['LOW_CONFIDENCE'],
        confidence: 0.68,
      },
      {
        orderIndex: 10,
        reasons: ['STEP_CHECK_MISMATCH'],
        confidence: 0.72,
      },
    ],
  },
  // --- Cohort 3 (TREATMENT - EXP892): 1 student in NEEDS_REVIEW ---
  {
    displayName: 'جنى ماجد السليمان',
    resumeCode: 'JNA249',
    cohortKey: 'EXP3',
    stage: 'NEEDS_REVIEW',
    watchedSeconds: 95,
    m1Profile: {
      1: 'full',
      2: 'full',
      3: 'full',
      4: 'full',
      5: 'full',
      6: 'full',
      7: 'partial',
      8: 'partial',
      9: 'full',
      10: 'partial',
    },
    reviewItems: [
      {
        orderIndex: 8,
        reasons: ['HIGH_ILLEGIBLE_RATIO', 'LOW_CONFIDENCE'],
        confidence: 0.61,
        misreadNoteAr: 'الخط واضح في الورقة الأصلية عند كتابة 2^x ln(2)، يرجى مراجعة التصحيح.',
      },
    ],
  },
];

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const prisma = getPrisma();
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

  const email = env.SEED_TEACHER_EMAIL.trim().toLowerCase();
  const passwordHash = await hashPassword(env.SEED_TEACHER_PASSWORD);

  const teacher = await prisma.user.upsert({
    where: { email },
    update: {
      displayName: env.SEED_TEACHER_NAME,
    },
    create: {
      email,
      passwordHash,
      displayName: env.SEED_TEACHER_NAME,
      role: 'TEACHER',
    },
  });

  logger.info({ teacherId: teacher.id, email: teacher.email }, 'Seeded default teacher');

  // Remove old English-titled topic if present from earlier seed runs
  const legacyEnglishTopics = await prisma.topic.findMany({
    where: {
      ownerId: teacher.id,
      title: 'Derivatives of Exponential and Logarithmic Functions',
      deletedAt: null,
    },
  });
  for (const oldTopic of legacyEnglishTopics) {
    await prisma.topic.update({
      where: { id: oldTopic.id },
      data: { deletedAt: new Date() },
    });
  }

  // 1. Seed Primary Arabic Topic (Published)
  const seedFile = path.resolve(repoRoot, 'seed/exams.seed.json');
  const rawSeed = await readFileText(seedFile);
  const bundle1 = SeedTopicBundleSchema.parse(JSON.parse(rawSeed) as unknown);
  const importService = new ExamImportExportService(prisma, env);
  const seedResult1 = await importService.seedTopicBundleIfMissing(teacher.id, bundle1);

  // Upgrade Topic 1 to have valid YouTube video URL, non-zero timestamps, confirmed Qs, and PUBLISHED models
  const now = new Date();
  const primaryVideoUrl = 'https://www.youtube.com/watch?v=WUvTyaaNkzM';
  const primaryVideoId = 'WUvTyaaNkzM';

  await prisma.topic.update({
    where: { id: seedResult1.topicId },
    data: {
      title: bundle1.topic.title,
      description: bundle1.topic.description,
      videoUrl: primaryVideoUrl,
      videoId: primaryVideoId,
      minWatchSeconds: 300,
      correctnessThreshold: 0.6,
    },
  });

  const topic1Models = await prisma.examModel.findMany({
    where: { topicId: seedResult1.topicId, deletedAt: null },
    include: {
      questions: {
        where: { deletedAt: null },
        orderBy: { orderIndex: 'asc' },
        include: {
          mcqOptions: { where: { deletedAt: null }, orderBy: { label: 'asc' } },
          rubricCriteria: { where: { deletedAt: null }, orderBy: { orderIndex: 'asc' } },
          modelAnswer: true,
        },
      },
    },
  });

  const timestampsByOrder: Record<number, number> = {
    1: 45,
    2: 95,
    3: 150,
    4: 205,
    5: 265,
    6: 330,
    7: 405,
    8: 470,
    9: 540,
    10: 615,
  };

  for (const model of topic1Models) {
    for (const q of model.questions) {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          videoTimestampSeconds: timestampsByOrder[q.orderIndex] ?? q.orderIndex * 50,
          needsTeacherConfirmation: false,
          teacherConfirmedAt: now,
        },
      });
    }
    await prisma.examModel.update({
      where: { id: model.id },
      data: {
        status: 'PUBLISHED',
        title:
          model.modelNumber === 1
            ? 'النموذج الأول — الاختبار القبلي: تفاضل الدوال الأسية واللوغاريتمية'
            : 'النموذج الثاني — الاختبار البعدي: تفاضل الدوال الأسية واللوغاريتمية',
      },
    });
  }

  // 2. Seed Secondary Arabic Topic (Draft — so Topics & Builder pages show both Published & Draft states)
  const seedResult2 = await importService.seedTopicBundleIfMissing(teacher.id, TOPIC_2_BUNDLE);

  logger.info(
    {
      primaryTopicId: seedResult1.topicId,
      secondaryTopicId: seedResult2.topicId,
    },
    'Seeded Arabic topics with English mathematical equations & problems',
  );

  // 3. Pre-generate handwritten PNG sheets for Model 1 & Model 2 essay questions (Q5..Q10)
  const sheetCache = new Map<
    string,
    { storageKey: string; sha256: string; width: number; height: number; bytes: number }
  >();

  for (const modelNumber of [1, 2] as const) {
    const samples = modelNumber === 1 ? ESSAY_SAMPLES_M1 : ESSAY_SAMPLES_M2;
    for (const orderIndex of [5, 6, 7, 8, 9, 10]) {
      const sample = samples[orderIndex]!;
      for (const variant of ['full', 'partial'] as const) {
        const keyId = `m${modelNumber}-q${orderIndex}-${variant}`;
        const storageKey = `seed-handwritten/${keyId}.png`;
        const rendered = await renderHandwrittenSheetPng({
          questionOrder: orderIndex,
          conceptKey: `M${modelNumber}-Q${orderIndex}`,
          lines: variant === 'full' ? sample.fullSteps : sample.partialSteps,
          finalLine: variant === 'full' ? sample.finalCorrect : sample.finalWrong,
        });
        await writeStorageFileToBothDirs(storageKey, rendered.buffer, repoRoot);
        sheetCache.set(keyId, {
          storageKey,
          sha256: rendered.sha256,
          width: rendered.width,
          height: rendered.height,
          bytes: rendered.buffer.byteLength,
        });
      }
    }
  }

  // 4. Upsert 3 Arabic Cohorts (6-char unambiguous codes from CODE_ALPHABET)
  await prisma.student.deleteMany({
    where: {
      resumeCode: {
        in: [
          'RES-ABD01',
          'RES-SAR02',
          'RES-OMR03',
          'RES-MRY04',
          'RES-YSF05',
          'RES-NOR06',
          'RES-KHL07',
          'RES-LIN08',
          'RES-FSL09',
          'RES-REM10',
          'RES-HMZ11',
          'RES-DAN12',
          'RES-TLL13',
          'RES-JNA14',
        ],
      },
    },
  });
  await prisma.cohort.deleteMany({
    where: { joinCode: { in: ['ML-EXP01', 'ML-CTR02', 'ML-EXP03'] } },
  });

  const cohortSpecs = [
    {
      key: 'EXP1' as const,
      joinCode: 'EXP234',
      name: 'الشعبة أ — المجموعة التجريبية (ثالث ثانوي علمي ١)',
      group: 'TREATMENT' as const,
      requireVideoBeforePost: true,
      requireWrongSegmentVisits: false,
      showProvisionalScore: true,
      postTestOpensAt: null,
    },
    {
      key: 'CTR2' as const,
      joinCode: 'CTR567',
      name: 'الشعبة ب — المجموعة الضابطة (ثالث ثانوي علمي ٢)',
      group: 'CONTROL' as const,
      requireVideoBeforePost: false,
      requireWrongSegmentVisits: false,
      showProvisionalScore: true,
      postTestOpensAt: new Date(Date.now() - 3 * 86_400_000),
    },
    {
      key: 'EXP3' as const,
      joinCode: 'EXP892',
      name: 'الشعبة ج — المجموعة التجريبية المسائية (ثالث ثانوي علمي ٣)',
      group: 'TREATMENT' as const,
      requireVideoBeforePost: true,
      requireWrongSegmentVisits: true,
      showProvisionalScore: false,
      postTestOpensAt: null,
    },
  ];

  const cohortByKey = new Map<'EXP1' | 'CTR2' | 'EXP3', { id: string; joinCode: string }>();
  for (const cs of cohortSpecs) {
    const cohort = await prisma.cohort.upsert({
      where: { joinCode: cs.joinCode },
      update: {
        name: cs.name,
        topicId: seedResult1.topicId,
        teacherId: teacher.id,
        group: cs.group,
        requireVideoBeforePost: cs.requireVideoBeforePost,
        requireWrongSegmentVisits: cs.requireWrongSegmentVisits,
        showProvisionalScore: cs.showProvisionalScore,
        postTestOpensAt: cs.postTestOpensAt,
        status: 'OPEN',
        deletedAt: null,
      },
      create: {
        name: cs.name,
        joinCode: cs.joinCode,
        topicId: seedResult1.topicId,
        teacherId: teacher.id,
        group: cs.group,
        requireVideoBeforePost: cs.requireVideoBeforePost,
        requireWrongSegmentVisits: cs.requireWrongSegmentVisits,
        showProvisionalScore: cs.showProvisionalScore,
        postTestOpensAt: cs.postTestOpensAt,
        status: 'OPEN',
      },
    });
    cohortByKey.set(cs.key, { id: cohort.id, joinCode: cohort.joinCode });
  }

  // Reload Topic 1 models with updated questions
  const m1 = topic1Models.find((m) => m.modelNumber === 1)!;
  const m2 = topic1Models.find((m) => m.modelNumber === 2)!;

  // Wipe previous seeded students matching our resumeCodes so re-running seed is cleanly idempotent
  const seededResumeCodes = MOCK_STUDENTS.map((s) => s.resumeCode);
  await prisma.student.deleteMany({
    where: { resumeCode: { in: seededResumeCodes } },
  });

  const allSeededAnswerIds: string[] = [];

  // Helper to populate a single attempt (Model 1 or Model 2) for a student
  const createAttemptWithAnswers = async (opts: {
    studentId: string;
    model: typeof m1;
    profile: Record<number, 'full' | 'partial' | 'wrong'>;
    attemptStatus: 'GRADED' | 'NEEDS_REVIEW' | 'FINAL';
    startedAt: Date;
    submittedAt: Date;
    reviewItems?: MockStudentSpec['reviewItems'];
    overrideItems?: MockStudentSpec['overrideItems'];
  }) => {
    const samples = opts.model.modelNumber === 1 ? ESSAY_SAMPLES_M1 : ESSAY_SAMPLES_M2;
    const reviewByOrder = new Map((opts.reviewItems ?? []).map((r) => [r.orderIndex, r]));
    const overrideByOrder = new Map(
      (opts.overrideItems ?? [])
        .filter((o) => o.modelNumber === opts.model.modelNumber)
        .map((o) => [o.orderIndex, o]),
    );

    const attempt = await prisma.attempt.create({
      data: {
        studentId: opts.studentId,
        examModelId: opts.model.id,
        status: opts.attemptStatus,
        startedAt: opts.startedAt,
        submittedAt: opts.submittedAt,
        deadlineAt: new Date(opts.startedAt.getTime() + 60 * 60_000),
        maxScore: 100,
        totalScore: 0,
        percentage: 0,
        scoreSource: overrideByOrder.size > 0 ? 'MIXED' : 'AI',
      },
    });

    let runningTotal = 0;

    for (const q of opts.model.questions) {
      const tier = opts.profile[q.orderIndex] ?? 'partial';

      if (q.type === 'MCQ') {
        const correctOpt = q.mcqOptions.find((o) => o.isCorrect) ?? q.mcqOptions[0]!;
        const wrongOpt = q.mcqOptions.find((o) => !o.isCorrect) ?? q.mcqOptions[1]!;
        const isCorrect = tier === 'full';
        const score = isCorrect ? q.points : 0;
        runningTotal += score;

        await prisma.answer.create({
          data: {
            attemptId: attempt.id,
            questionId: q.id,
            selectedOptionId: isCorrect ? correctOpt.id : wrongOpt.id,
            isCorrect,
            score,
            maxScore: q.points,
          },
        });
        continue;
      }

      // ESSAY question
      const sample = samples[q.orderIndex]!;
      const revSpec = reviewByOrder.get(q.orderIndex);
      const ovSpec = overrideByOrder.get(q.orderIndex);
      const isFull = tier === 'full';

      // Compute criterion scores
      const criteriaList = q.rubricCriteria.map((crit, idx) => {
        const awarded = isFull
          ? crit.maxPoints
          : idx < Math.ceil(q.rubricCriteria.length * 0.6)
            ? crit.maxPoints
            : 0;
        const commentAr = isFull
          ? (sample.criteriaCommentsFullAr[idx] ?? crit.descriptionAr)
          : (sample.criteriaCommentsPartialAr[idx] ?? crit.descriptionAr);
        return {
          criterionId: crit.id,
          criterionKey: crit.key,
          key: crit.key,
          descriptionEn: crit.descriptionEn,
          descriptionAr: crit.descriptionAr,
          awardedPoints: awarded,
          maxPoints: crit.maxPoints,
          met: awarded >= crit.maxPoints,
          commentAr,
        };
      });

      const aiTotal = criteriaList.reduce((acc, c) => acc + c.awardedPoints, 0);
      const effectiveTotal = ovSpec
        ? Math.min(q.points, Math.max(0, aiTotal + ovSpec.bonusDelta))
        : aiTotal;
      const isCorrect = effectiveTotal >= q.points * 0.6;
      runningTotal += effectiveTotal;

      const ans = await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: q.id,
          isCorrect,
          score: effectiveTotal,
          maxScore: q.points,
          misreadReportedAt: revSpec?.misreadNoteAr
            ? new Date(opts.submittedAt.getTime() + 5 * 60_000)
            : null,
          misreadNote: revSpec?.misreadNoteAr ?? null,
        },
      });
      allSeededAnswerIds.push(ans.id);

      const sheetVariant = isFull ? 'full' : 'partial';
      const sheet = sheetCache.get(`m${opts.model.modelNumber}-q${q.orderIndex}-${sheetVariant}`)!;
      await prisma.answerImage.create({
        data: {
          answerId: ans.id,
          storageKey: sheet.storageKey,
          sha256: sheet.sha256,
          width: sheet.width,
          height: sheet.height,
          bytes: sheet.bytes,
          pinnedByTeacher: Boolean(ovSpec || revSpec),
        },
      });

      const rawLines = isFull ? sample.fullSteps : sample.partialSteps;
      const transcribedLines = rawLines.map((lineText, idx) => ({
        lineNumber: idx + 1,
        textLatex: lineText,
        confidence: revSpec ? Math.max(0.55, revSpec.confidence - idx * 0.03) : 0.94,
        hasUnsure: Boolean(revSpec && idx === rawLines.length - 1),
        illegible: Boolean(
          revSpec?.reasons.includes('HIGH_ILLEGIBLE_RATIO') && idx === rawLines.length - 1,
        ),
        crossedOut: false,
      }));

      const gr = await prisma.gradingResult.create({
        data: {
          answerId: ans.id,
          version: 1,
          provider: 'groq',
          modelName: 'meta-llama/llama-4-scout-17b-16e-instruct',
          promptVersion: 'v1.2.0',
          rubricVersion: 1,
          imageHash: sheet.sha256,
          transcriptionJson: {
            lines: transcribedLines,
            fullTranscriptionLatex: rawLines.join(' \\\\ '),
          },
          gradingJson: {
            criteriaScores: criteriaList,
          },
          criteriaScores: criteriaList,
          aiTotal,
          finalAnswerCorrect: isFull,
          firstErrorStep: isFull ? null : rawLines.length,
          errorType: isFull ? 'none' : 'differentiation_rule_error',
          errorExplanationAr: isFull ? sample.explanationFullAr : sample.explanationPartialAr,
          hintAr: isFull ? '' : sample.hintAr,
          confidence: revSpec ? revSpec.confidence : isFull ? 0.95 : 0.88,
          sympyCheck: {
            checked: Boolean(q.modelAnswer?.finalAnswerSympy),
            status: revSpec?.reasons.includes('SYMPY_MISMATCH')
              ? 'MISMATCH'
              : isFull
                ? 'EQUIVALENT'
                : 'NOT_EQUIVALENT',
            detail: isFull
              ? 'Symbolic equivalence verified by SymPy'
              : 'Student final expression differs from model answer',
          },
          needsReview: Boolean(revSpec),
          reviewReasons: revSpec?.reasons ?? [],
          rawOutput: JSON.stringify({ aiTotal, confidence: revSpec?.confidence ?? 0.92 }),
          latencyMs: 1450 + q.orderIndex * 95,
          costUsd: 0.0042,
        },
      });

      if (ovSpec) {
        const overrideCriteria = criteriaList.map((c, idx) => {
          const bumped =
            idx === criteriaList.length - 1
              ? Math.min(c.maxPoints, c.awardedPoints + ovSpec.bonusDelta)
              : c.awardedPoints;
          return {
            criterionId: c.criterionId,
            key: c.key,
            descriptionEn: c.descriptionEn,
            descriptionAr: c.descriptionAr,
            awarded: bumped,
            maxPoints: c.maxPoints,
            commentAr: c.commentAr,
            clamped: false,
          };
        });

        await prisma.teacherOverride.create({
          data: {
            gradingResultId: gr.id,
            teacherId: teacher.id,
            newCriteriaScores: overrideCriteria,
            newTotal: effectiveTotal,
            newExplanationAr: ovSpec.explanationAr,
            note: ovSpec.noteAr,
          },
        });
      }
    }

    const percentage = Math.round(runningTotal * 100) / 100;
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        totalScore: runningTotal,
        percentage,
      },
    });
  };

  // 5. Create Students, Attempts, VideoSessions, and VideoEvents
  for (let idx = 0; idx < MOCK_STUDENTS.length; idx += 1) {
    const spec = MOCK_STUDENTS[idx]!;
    const cohort = cohortByKey.get(spec.cohortKey)!;
    const baseTime = new Date(Date.now() - (12 - (idx % 10)) * 86_400_000);

    const student = await prisma.student.create({
      data: {
        cohortId: cohort.id,
        displayName: spec.displayName,
        resumeCode: spec.resumeCode,
        consentAcceptedAt: baseTime,
      },
    });

    const preStart = new Date(baseTime.getTime() + 10 * 60_000);
    const preSubmit = new Date(preStart.getTime() + 38 * 60_000);

    const preStatus =
      spec.stage === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : spec.stage === 'REMEDIATION_VIDEO'
          ? 'GRADED'
          : 'FINAL';

    await createAttemptWithAnswers({
      studentId: student.id,
      model: m1,
      profile: spec.m1Profile,
      attemptStatus: preStatus,
      startedAt: preStart,
      submittedAt: preSubmit,
      reviewItems: spec.reviewItems,
      overrideItems: spec.overrideItems,
    });

    // VideoSession for students who watched remediation video
    if (spec.watchedSeconds > 0) {
      const videoCompleted = spec.watchedSeconds >= 300;
      const completedAt = videoCompleted ? new Date(preSubmit.getTime() + 25 * 60_000) : null;
      const unlockSig =
        videoCompleted && completedAt
          ? signVideoUnlock(
              student.id,
              seedResult1.topicId,
              completedAt.toISOString(),
              env.VIDEO_UNLOCK_HMAC_SECRET,
            )
          : null;

      const visitedQIds = m1.questions
        .filter((q) => (spec.m1Profile[q.orderIndex] ?? 'partial') !== 'full')
        .map((q) => q.id);

      const vs = await prisma.videoSession.create({
        data: {
          studentId: student.id,
          topicId: seedResult1.topicId,
          startedAt: new Date(preSubmit.getTime() + 10 * 60_000),
          watchedSeconds: spec.watchedSeconds,
          watchedIntervals: [[0, spec.watchedSeconds]],
          visitedQuestionIds: visitedQIds,
          lastPosition: spec.watchedSeconds,
          lastHeartbeatAt: new Date(preSubmit.getTime() + 25 * 60_000),
          completedAt,
          unlockedPostAt: completedAt,
          unlockSignature: unlockSig,
        },
      });

      await prisma.videoEvent.createMany({
        data: [
          {
            videoSessionId: vs.id,
            type: 'PLAY',
            position: 0,
            playbackRate: 1,
            clientTs: new Date(preSubmit.getTime() + 10 * 60_000),
          },
          {
            videoSessionId: vs.id,
            type: 'HEARTBEAT',
            position: Math.min(150, spec.watchedSeconds),
            playbackRate: 1,
            clientTs: new Date(preSubmit.getTime() + 15 * 60_000),
          },
          ...(videoCompleted
            ? [
                {
                  videoSessionId: vs.id,
                  type: 'ENDED' as const,
                  position: spec.watchedSeconds,
                  playbackRate: 1,
                  clientTs: completedAt!,
                },
              ]
            : []),
        ],
      });
    }

    // Post-test attempt (Model 2) for COMPLETED_BOTH students
    if (spec.stage === 'COMPLETED_BOTH' && spec.m2Profile) {
      const postStart = new Date(preSubmit.getTime() + 60 * 60_000);
      const postSubmit = new Date(postStart.getTime() + 35 * 60_000);
      await createAttemptWithAnswers({
        studentId: student.id,
        model: m2,
        profile: spec.m2Profile,
        attemptStatus: 'FINAL',
        startedAt: postStart,
        submittedAt: postSubmit,
        overrideItems: spec.overrideItems,
      });
    }
  }

  // 6. Seed AI Usage & Cost logs across the last 10 days (including today) for UsagePage
  await prisma.aiUsage.deleteMany({});

  const usageRows: Array<{
    answerId: string | null;
    provider: string;
    modelName: string;
    operation: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    success: boolean;
    errorCode: string | null;
    createdAt: Date;
  }> = [];

  for (let dayOffset = 9; dayOffset >= 0; dayOffset -= 1) {
    const dayDate = new Date(Date.now() - dayOffset * 86_400_000);
    const callsForDay = dayOffset === 0 ? 6 : 4 + (dayOffset % 3);

    for (let c = 0; c < callsForDay; c += 1) {
      const isTranscribe = c % 2 === 0;
      const useGroq = c % 3 !== 0;
      const ansId =
        allSeededAnswerIds[(dayOffset * 5 + c) % Math.max(1, allSeededAnswerIds.length)] ?? null;
      const isError = dayOffset === 4 && c === callsForDay - 1;

      usageRows.push({
        answerId: ansId,
        provider: useGroq ? 'groq' : 'anthropic',
        modelName: useGroq
          ? 'meta-llama/llama-4-scout-17b-16e-instruct'
          : 'claude-sonnet-4-20250514',
        operation: isTranscribe ? 'transcribe' : 'grade',
        inputTokens: isTranscribe ? 1420 + c * 80 : 1850 + c * 110,
        outputTokens: isTranscribe ? 310 + c * 25 : 540 + c * 35,
        costUsd: useGroq ? (isTranscribe ? 0.0024 : 0.0038) : isTranscribe ? 0.0085 : 0.0132,
        latencyMs: useGroq ? 1180 + c * 140 : 2150 + c * 190,
        success: !isError,
        errorCode: isError ? 'AI_TIMEOUT' : null,
        createdAt: new Date(dayDate.getTime() - c * 15 * 60_000),
      });
    }
  }

  await prisma.aiUsage.createMany({ data: usageRows });

  logger.info(
    {
      cohortsSeeded: cohortSpecs.length,
      studentsSeeded: MOCK_STUDENTS.length,
      essayAnswersSeeded: allSeededAnswerIds.length,
      aiUsageCallsSeeded: usageRows.length,
    },
    'Seeded comprehensive Arabic mock data across all pages',
  );

  await prisma.$disconnect();
}

async function readFileText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
