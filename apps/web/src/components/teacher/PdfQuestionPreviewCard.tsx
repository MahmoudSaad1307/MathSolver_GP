import { AlertTriangle, CheckCircle2, Eye, Pencil } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MathBlock } from '@/components/MathBlock';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import type { ExtractedQuestionPreview, PdfSympyVerificationStatus } from '@/types/content';

interface PdfQuestionPreviewCardProps {
  modelNumber: 1 | 2;
  question: ExtractedQuestionPreview;
  locale: 'ar' | 'en';
  onChange: (updated: ExtractedQuestionPreview) => void;
  onInspectPage: (modelNumber: 1 | 2, pageNumber: number) => void;
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function sympyTone(
  status: PdfSympyVerificationStatus,
): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (status) {
    case 'VERIFIED':
      return 'success';
    case 'MISMATCH':
      return 'danger';
    case 'UNPARSABLE':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function PdfQuestionPreviewCard({
  modelNumber,
  question,
  locale,
  onChange,
  onInspectPage,
}: PdfQuestionPreviewCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState(false);

  const isFlagged = question.needsTeacherConfirmation && !question.verifiedByTeacher;
  const rubricSum = (question.rubricCriteria ?? []).reduce((acc, c) => acc + c.maxPoints, 0);
  const rubricValid = question.type !== 'ESSAY' || Math.abs(rubricSum - question.points) <= 0.01;

  function toggleVerified() {
    onChange({ ...question, verifiedByTeacher: !question.verifiedByTeacher });
  }

  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
        isFlagged ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200'
      }`}
    >
      {/* Header row with status & source page jump buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="info">
            #{question.orderIndex} · {question.type}
          </Badge>
          <Badge tone="neutral">{question.points} pts</Badge>
          <Badge tone={sympyTone(question.sympyStatus)}>
            {t(`pdfImport.sympy_${question.sympyStatus}`)}
          </Badge>
          <Badge tone={question.ocrConfidence >= 0.85 ? 'success' : 'warning'}>
            OCR {Math.round(question.ocrConfidence * 100)}%
          </Badge>
          <Badge tone={question.dualOcrAgreed ? 'neutral' : 'danger'}>
            {question.dualOcrAgreed ? t('pdfImport.dualAgreed') : t('pdfImport.dualDisagreed')}
          </Badge>
          {question.verifiedByTeacher ? (
            <Badge tone="success">{t('pdfImport.verifiedBadge')}</Badge>
          ) : question.needsTeacherConfirmation ? (
            <Badge tone="warning">{t('pdfImport.needsCheckBadge')}</Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {question.sourceQuestionPages.map((pno) => (
            <Button
              key={`q-${pno}`}
              variant="outline"
              size="sm"
              onClick={() => onInspectPage(modelNumber, pno)}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{t('pdfImport.viewQuestionPage', { page: pno })}</span>
            </Button>
          ))}
          {question.sourceAnswerPages.map((pno) => (
            <Button
              key={`a-${pno}`}
              variant="outline"
              size="sm"
              onClick={() => onInspectPage(modelNumber, pno)}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{t('pdfImport.viewAnswerPage', { page: pno })}</span>
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            <Pencil className="h-3.5 w-3.5" />
            <span>{editing ? t('pdfImport.doneEditing') : t('pdfImport.editQuestion')}</span>
          </Button>
          <Button
            variant={question.verifiedByTeacher ? 'secondary' : 'primary'}
            size="sm"
            onClick={toggleVerified}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t('pdfImport.markVerified')}</span>
          </Button>
        </div>
      </div>

      {/* Extraction warnings */}
      {question.warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {question.warnings.map((w, idx) => (
            <Alert
              key={`${w.code}-${idx}`}
              tone={
                w.severity === 'error' ? 'danger' : w.severity === 'warning' ? 'warning' : 'info'
              }
              className="flex items-start gap-2 py-2 text-xs"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{locale === 'ar' ? w.messageAr : w.messageEn}</span>
            </Alert>
          ))}
        </div>
      )}

      {/* Body: view mode vs inline edit mode */}
      {editing ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label>{t('pdfImport.conceptKeyLabel')}</Label>
              <Input
                value={question.conceptKey}
                onChange={(e) => onChange({ ...question, conceptKey: e.target.value })}
              />
            </div>
            <div>
              <Label>{t('pdfImport.pointsLabel')}</Label>
              <Input
                type="number"
                min="0.5"
                max="100"
                step="0.5"
                value={question.points}
                onChange={(e) =>
                  onChange({ ...question, points: Math.max(0.5, Number(e.target.value) || 1) })
                }
              />
            </div>
          </div>

          <div>
            <Label>{t('pdfImport.promptLabel')}</Label>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={question.promptLatex}
              onChange={(e) => onChange({ ...question, promptLatex: e.target.value })}
            />
          </div>

          {question.type === 'MCQ' && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              {(question.mcqOptions ?? []).map((opt, idx) => (
                <div key={opt.label} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${question.tempId}`}
                    checked={opt.isCorrect}
                    aria-label={`${opt.label} ${t('pdfImport.correctOption')}`}
                    onChange={() => {
                      const nextOpts = (question.mcqOptions ?? []).map((o, i) => ({
                        ...o,
                        isCorrect: i === idx,
                      }));
                      onChange({ ...question, mcqOptions: nextOpts });
                    }}
                  />
                  <span className="w-6 text-xs font-bold text-slate-700">{opt.label}</span>
                  <Input
                    value={opt.textLatex}
                    onChange={(e) => {
                      const nextOpts = (question.mcqOptions ?? []).map((o, i) =>
                        i === idx ? { ...o, textLatex: e.target.value } : o,
                      );
                      onChange({ ...question, mcqOptions: nextOpts });
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {question.type === 'ESSAY' && (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              <div>
                <Label>{t('pdfImport.solutionStepsLabel')}</Label>
                <textarea
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  value={(question.modelAnswer?.solutionStepsLatex ?? []).join('\n')}
                  onChange={(e) =>
                    onChange({
                      ...question,
                      modelAnswer: {
                        solutionStepsLatex: e.target.value.split('\n'),
                        finalAnswerLatex: question.modelAnswer?.finalAnswerLatex ?? '',
                        finalAnswerSympy: question.modelAnswer?.finalAnswerSympy ?? null,
                        commonMistakes: question.modelAnswer?.commonMistakes ?? '',
                      },
                    })
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>{t('pdfImport.finalAnswerLatexLabel')}</Label>
                  <Input
                    value={question.modelAnswer?.finalAnswerLatex ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...question,
                        modelAnswer: {
                          solutionStepsLatex: question.modelAnswer?.solutionStepsLatex ?? [],
                          finalAnswerLatex: e.target.value,
                          finalAnswerSympy: question.modelAnswer?.finalAnswerSympy ?? null,
                          commonMistakes: question.modelAnswer?.commonMistakes ?? '',
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>{t('pdfImport.finalAnswerSympyLabel')}</Label>
                  <Input
                    value={question.modelAnswer?.finalAnswerSympy ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...question,
                        modelAnswer: {
                          solutionStepsLatex: question.modelAnswer?.solutionStepsLatex ?? [],
                          finalAnswerLatex: question.modelAnswer?.finalAnswerLatex ?? '',
                          finalAnswerSympy: e.target.value.trim() || null,
                          commonMistakes: question.modelAnswer?.commonMistakes ?? '',
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>{t('pdfImport.rubricLabel')}</span>
                  <span className={rubricValid ? 'text-emerald-700' : 'text-red-700'}>
                    {t('pdfImport.rubricSum', {
                      sum: rubricSum.toFixed(2),
                      points: question.points,
                    })}
                  </span>
                </div>
                {(question.rubricCriteria ?? []).map((crit, idx) => (
                  <div key={`${crit.key}-${idx}`} className="grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      <Input
                        value={crit.descriptionEn}
                        onChange={(e) => {
                          const next = (question.rubricCriteria ?? []).map((c, i) =>
                            i === idx ? { ...c, descriptionEn: e.target.value } : c,
                          );
                          onChange({ ...question, rubricCriteria: next });
                        }}
                      />
                    </div>
                    <div className="col-span-5">
                      <Input
                        value={crit.descriptionAr}
                        onChange={(e) => {
                          const next = (question.rubricCriteria ?? []).map((c, i) =>
                            i === idx ? { ...c, descriptionAr: e.target.value } : c,
                          );
                          onChange({ ...question, rubricCriteria: next });
                        }}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        min="0.1"
                        max="100"
                        step="0.5"
                        value={crit.maxPoints}
                        onChange={(e) => {
                          const next = (question.rubricCriteria ?? []).map((c, i) =>
                            i === idx
                              ? { ...c, maxPoints: Math.max(0.1, Number(e.target.value) || 0.1) }
                              : c,
                          );
                          onChange({ ...question, rubricCriteria: next });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-mono">conceptKey: {question.conceptKey}</span>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-900">
            <MathBlock text={question.promptLatex} forceLtr={!hasArabic(question.promptLatex)} />
          </div>

          {question.type === 'MCQ' && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(question.mcqOptions ?? []).map((opt) => (
                <div
                  key={opt.label}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    opt.isCorrect
                      ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-950'
                      : 'border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  <span className="font-bold">{opt.label})</span>
                  <MathBlock
                    text={opt.textLatex}
                    forceLtr={!hasArabic(opt.textLatex)}
                    className="flex-1"
                  />
                  {opt.isCorrect && (
                    <Badge tone="success" className="shrink-0">
                      {t('pdfImport.correctOption')}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}

          {question.type === 'ESSAY' && question.modelAnswer && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-sm">
              <div className="space-y-1">
                {question.modelAnswer.solutionStepsLatex.map((step, idx) => (
                  <div key={idx} className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-400">{idx + 1}.</span>
                    <MathBlock text={step} forceLtr={!hasArabic(step)} className="flex-1" />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
                <span className="text-xs font-semibold text-slate-600">
                  {t('pdfImport.finalAnswerLatexLabel')}:
                </span>
                <MathBlock
                  text={
                    question.modelAnswer.finalAnswerLatex.includes('$')
                      ? question.modelAnswer.finalAnswerLatex
                      : `$$${question.modelAnswer.finalAnswerLatex}$$`
                  }
                  forceLtr={!hasArabic(question.modelAnswer.finalAnswerLatex)}
                  className="font-semibold text-brand-800"
                />
              </div>
              {question.rubricCriteria && question.rubricCriteria.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-slate-200 pt-2 text-xs">
                  {question.rubricCriteria.map((c, idx) => (
                    <Badge key={idx} tone={rubricValid ? 'neutral' : 'danger'}>
                      {locale === 'ar' ? c.descriptionAr : c.descriptionEn}: {c.maxPoints} pts
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
