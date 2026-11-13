import { isRubricSumValid, UpsertQuestionSchema, type QuestionType } from '@mathlens/shared';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { MathBlock } from '@/components/MathBlock';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import {
  buildYoutubePreviewUrl,
  formatSecondsToMmSs,
  parseMmSsToSeconds,
} from '@/lib/timeFormat';
import { useUiStore } from '@/store/uiStore';
import type { QuestionItem } from '@/types/content';

interface QuestionEditorModalProps {
  examId: string;
  topicVideoUrl: string;
  nextOrderIndex: number;
  initialQuestion?: QuestionItem | null;
  onClose: () => void;
  onSaved: () => void;
}

interface EditableOption {
  label: 'A' | 'B' | 'C' | 'D';
  textLatex: string;
  isCorrect: boolean;
}

interface EditableCriterion {
  key: string;
  descriptionEn: string;
  descriptionAr: string;
  maxPoints: number;
}

const DEFAULT_OPTIONS: EditableOption[] = [
  { label: 'A', textLatex: '$A$', isCorrect: true },
  { label: 'B', textLatex: '$B$', isCorrect: false },
  { label: 'C', textLatex: '$C$', isCorrect: false },
  { label: 'D', textLatex: '$D$', isCorrect: false },
];

export function QuestionEditorModal({
  examId,
  topicVideoUrl,
  nextOrderIndex,
  initialQuestion,
  onClose,
  onSaved,
}: QuestionEditorModalProps) {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const isEditing = Boolean(initialQuestion);

  const [orderIndex, setOrderIndex] = React.useState(
    initialQuestion?.orderIndex ?? nextOrderIndex,
  );
  const [conceptKey, setConceptKey] = React.useState(initialQuestion?.conceptKey ?? '');
  const [type, setType] = React.useState<QuestionType>(initialQuestion?.type ?? 'MCQ');
  const [points, setPoints] = React.useState(initialQuestion?.points ?? 5);
  const [mmSs, setMmSs] = React.useState(
    formatSecondsToMmSs(initialQuestion?.videoTimestampSeconds ?? 0),
  );
  const [promptLatex, setPromptLatex] = React.useState(initialQuestion?.promptLatex ?? '');
  const [needsConfirm, setNeedsConfirm] = React.useState(
    initialQuestion?.needsTeacherConfirmation ?? false,
  );

  const [options, setOptions] = React.useState<EditableOption[]>(() => {
    if (initialQuestion?.mcqOptions && initialQuestion.mcqOptions.length === 4) {
      return initialQuestion.mcqOptions.map((o) => ({
        label: o.label,
        textLatex: o.textLatex,
        isCorrect: o.isCorrect,
      }));
    }
    return DEFAULT_OPTIONS.map((o) => ({ ...o }));
  });

  const [steps, setSteps] = React.useState<string[]>(
    initialQuestion?.modelAnswer?.solutionStepsLatex.length
      ? [...initialQuestion.modelAnswer.solutionStepsLatex]
      : [''],
  );
  const [finalAnswerLatex, setFinalAnswerLatex] = React.useState(
    initialQuestion?.modelAnswer?.finalAnswerLatex ?? '',
  );
  const [finalAnswerSympy, setFinalAnswerSympy] = React.useState(
    initialQuestion?.modelAnswer?.finalAnswerSympy ?? '',
  );
  const [commonMistakes, setCommonMistakes] = React.useState(
    initialQuestion?.modelAnswer?.commonMistakes ?? '',
  );

  const [criteria, setCriteria] = React.useState<EditableCriterion[]>(() => {
    if (initialQuestion?.rubricCriteria && initialQuestion.rubricCriteria.length > 0) {
      return initialQuestion.rubricCriteria.map((c) => ({
        key: c.key,
        descriptionEn: c.descriptionEn,
        descriptionAr: c.descriptionAr,
        maxPoints: c.maxPoints,
      }));
    }
    return [
      {
        key: 'method',
        descriptionEn: 'Method and intermediate steps',
        descriptionAr: 'تطبيق الطريقة والخطوات الوسيطة',
        maxPoints: 5,
      },
      {
        key: 'final',
        descriptionEn: 'Final simplified result',
        descriptionAr: 'الناتج النهائي المبسط',
        maxPoints: 5,
      },
    ];
  });

  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const rubricSum = criteria.reduce((acc, c) => acc + (Number(c.maxPoints) || 0), 0);
  const rubricValid = type === 'MCQ' || isRubricSumValid(Number(points) || 0, criteria);
  const parsedSec = parseMmSsToSeconds(mmSs) ?? 0;
  const previewVideoUrl = buildYoutubePreviewUrl(topicVideoUrl, parsedSec);

  const handleMoveStep = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const tmp = next[index] ?? '';
    next[index] = next[target] ?? '';
    next[target] = tmp;
    setSteps(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const videoTimestampSeconds = parseMmSsToSeconds(mmSs);
    if (videoTimestampSeconds === null) {
      setErrorMsg(
        locale === 'ar'
          ? 'صيغة الوقت غير صالحة. استخدم الصيغة mm:ss مثل 03:45 أو عدداً بالثواني.'
          : 'Invalid timestamp format. Use mm:ss (e.g. 03:45) or seconds.',
      );
      return;
    }

    const payload = {
      orderIndex: Number(orderIndex),
      conceptKey: conceptKey.trim(),
      type,
      promptLatex: promptLatex.trim(),
      points: Number(points),
      videoTimestampSeconds,
      needsTeacherConfirmation: needsConfirm,
      ...(type === 'MCQ'
        ? {
            mcqOptions: options.map((o) => ({
              label: o.label,
              textLatex: o.textLatex.trim(),
              isCorrect: o.isCorrect,
            })),
          }
        : {
            modelAnswer: {
              solutionStepsLatex: steps.map((s) => s.trim()).filter(Boolean),
              finalAnswerLatex: finalAnswerLatex.trim(),
              finalAnswerSympy: finalAnswerSympy.trim() ? finalAnswerSympy.trim() : null,
              commonMistakes: commonMistakes.trim(),
            },
            rubricCriteria: criteria.map((c, idx) => ({
              orderIndex: idx + 1,
              key: c.key.trim(),
              descriptionEn: c.descriptionEn.trim(),
              descriptionAr: c.descriptionAr.trim(),
              maxPoints: Number(c.maxPoints),
            })),
          }),
    };

    const parsed = UpsertQuestionSchema.safeParse(payload);
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }

    setSaving(true);
    try {
      if (isEditing && initialQuestion) {
        await apiRequest(`/questions/${initialQuestion.id}`, {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
          retryRefresh: true,
        });
      } else {
        await apiRequest(`/exams/${examId}/questions`, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
          retryRefresh: true,
        });
      }
      onSaved();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-editor-title"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 id="question-editor-title" className="text-lg font-bold text-slate-900">
            {isEditing ? t('teacher.questionEditor.editTitle') : t('teacher.questionEditor.createTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('app.close')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}

          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="q-order">{t('teacher.questionEditor.orderIndex')}</Label>
              <Input
                id="q-order"
                type="number"
                min={1}
                value={orderIndex}
                onChange={(e) => setOrderIndex(Number(e.target.value))}
                dir="ltr"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="q-concept">{t('teacher.questionEditor.conceptKey')}</Label>
              <Input
                id="q-concept"
                value={conceptKey}
                onChange={(e) => setConceptKey(e.target.value)}
                placeholder="log-differentiation"
                dir="ltr"
                required
              />
            </div>
            <div>
              <Label htmlFor="q-points">{t('teacher.questionEditor.points')}</Label>
              <Input
                id="q-points"
                type="number"
                min={0.5}
                step={0.5}
                value={points}
                onChange={(e) => setPoints(Number(e.target.value))}
                dir="ltr"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="q-type">{t('teacher.questionEditor.type')}</Label>
              <select
                id="q-type"
                value={type}
                onChange={(e) => setType(e.target.value as QuestionType)}
                className="flex min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none"
              >
                <option value="MCQ">{t('teacher.questionEditor.mcq')}</option>
                <option value="ESSAY">{t('teacher.questionEditor.essay')}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="q-ts">{t('teacher.questionEditor.timestampMmSs')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="q-ts"
                  value={mmSs}
                  onChange={(e) => setMmSs(e.target.value)}
                  placeholder="02:30"
                  dir="ltr"
                />
                {previewVideoUrl && parsedSec > 0 && (
                  <a
                    href={previewVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-brand-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>{t('app.preview')}</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="q-prompt">{t('teacher.questionEditor.promptLatex')}</Label>
            <textarea
              id="q-prompt"
              rows={3}
              dir="ltr"
              value={promptLatex}
              onChange={(e) => setPromptLatex(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Find $\frac{dy}{dx}$ if $y = x^{\sin x}$."
              required
            />
            {promptLatex.trim() && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1 text-xs font-semibold text-slate-500">
                  {t('teacher.questionEditor.livePreview')}
                </div>
                <MathBlock text={promptLatex} />
              </div>
            )}
          </div>

          {type === 'MCQ' ? (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-bold text-slate-800">
                {t('teacher.questionEditor.optionsTitle')}
              </div>
              {options.map((opt, idx) => (
                <div key={opt.label} className="grid items-center gap-2 sm:grid-cols-12">
                  <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
                    <input
                      type="radio"
                      name="mcq-correct"
                      checked={opt.isCorrect}
                      onChange={() =>
                        setOptions((prev) =>
                          prev.map((item, i) => ({ ...item, isCorrect: i === idx })),
                        )
                      }
                    />
                    <span>
                      {opt.label} ({t('teacher.questionEditor.correctOption')})
                    </span>
                  </label>
                  <div className="sm:col-span-6">
                    <Input
                      value={opt.textLatex}
                      dir="ltr"
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, textLatex: e.target.value } : item,
                          ),
                        )
                      }
                      aria-label={`Option ${opt.label}`}
                    />
                  </div>
                  <div className="rounded bg-slate-50 px-2 py-1 text-sm sm:col-span-4">
                    <MathBlock text={opt.textLatex} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-800">
                  {t('teacher.questionEditor.solutionSteps')}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSteps((prev) => [...prev, ''])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('teacher.questionEditor.addStep')}</span>
                </Button>
              </div>
              <div className="space-y-2">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-6 text-center text-xs font-bold text-slate-500">
                      {idx + 1}
                    </span>
                    <Input
                      value={step}
                      dir="ltr"
                      onChange={(e) =>
                        setSteps((prev) => prev.map((s, i) => (i === idx ? e.target.value : s)))
                      }
                      placeholder="$\ln y = \sin x \ln x$"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleMoveStep(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Move step up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleMoveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      aria-label="Move step down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    {steps.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSteps((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Remove step"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="q-final-latex">{t('teacher.questionEditor.finalAnswerLatex')}</Label>
                  <Input
                    id="q-final-latex"
                    dir="ltr"
                    value={finalAnswerLatex}
                    onChange={(e) => setFinalAnswerLatex(e.target.value)}
                    required
                  />
                  {finalAnswerLatex.trim() && (
                    <div className="mt-1 rounded bg-slate-50 p-2">
                      <MathBlock text={finalAnswerLatex} />
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor="q-final-sympy">{t('teacher.questionEditor.finalAnswerSympy')}</Label>
                  <Input
                    id="q-final-sympy"
                    dir="ltr"
                    value={finalAnswerSympy}
                    onChange={(e) => setFinalAnswerSympy(e.target.value)}
                    placeholder="2*exp(2*x)"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="q-mistakes">{t('teacher.questionEditor.commonMistakes')}</Label>
                <Input
                  id="q-mistakes"
                  value={commonMistakes}
                  onChange={(e) => setCommonMistakes(e.target.value)}
                />
              </div>

              <div className="space-y-3 border-t border-slate-200 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">
                      {t('teacher.questionEditor.rubricTitle')}
                    </span>
                    <Badge tone={rubricValid ? 'success' : 'danger'}>
                      {t('teacher.questionEditor.rubricSum', {
                        sum: rubricSum,
                        total: points,
                      })}{' '}
                      —{' '}
                      {rubricValid
                        ? t('teacher.questionEditor.rubricMatch')
                        : t('teacher.questionEditor.rubricMismatch')}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setCriteria((prev) => [
                        ...prev,
                        {
                          key: `step_${prev.length + 1}`,
                          descriptionEn: '',
                          descriptionAr: '',
                          maxPoints: 1,
                        },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t('teacher.questionEditor.addCriterion')}</span>
                  </Button>
                </div>

                {criteria.map((c, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 sm:grid-cols-12"
                  >
                    <div className="sm:col-span-2">
                      <Input
                        dir="ltr"
                        value={c.key}
                        placeholder={t('teacher.questionEditor.criterionKey')}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, key: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <Input
                        dir="ltr"
                        value={c.descriptionEn}
                        placeholder={t('teacher.questionEditor.criterionEn')}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, descriptionEn: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <Input
                        value={c.descriptionAr}
                        placeholder={t('teacher.questionEditor.criterionAr')}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, descriptionAr: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center gap-1 sm:col-span-2">
                      <Input
                        type="number"
                        min={0.5}
                        step={0.5}
                        dir="ltr"
                        value={c.maxPoints}
                        onChange={(e) =>
                          setCriteria((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, maxPoints: Number(e.target.value) } : item,
                            ),
                          )
                        }
                      />
                      {criteria.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCriteria((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label="Remove criterion"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={needsConfirm}
              onChange={(e) => setNeedsConfirm(e.target.checked)}
            />
            <span>{t('teacher.questionEditor.requiresConfirm')}</span>
          </label>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <Button variant="outline" onClick={onClose}>
              {t('app.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !rubricValid}>
              {saving ? t('app.loading') : t('app.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
