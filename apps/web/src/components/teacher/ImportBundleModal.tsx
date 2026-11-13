import { SeedTopicBundleSchema } from '@mathlens/shared';
import { FileUp, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Input';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { BundleImportResult } from '@/types/content';

interface ImportBundleModalProps {
  targetTopicId?: string;
  onClose: () => void;
  onImported: (result: BundleImportResult) => void;
}

export function ImportBundleModal({ targetTopicId, onClose, onImported }: ImportBundleModalProps) {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const [rawJson, setRawJson] = React.useState('');
  const [preview, setPreview] = React.useState<BundleImportResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      setRawJson(text);
      setPreview(null);
      setErrorMsg(null);
    });
  };

  const executeImport = async (dryRun: boolean) => {
    setErrorMsg(null);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      setErrorMsg(locale === 'ar' ? 'نص JSON غير صالح.' : 'Invalid JSON syntax.');
      return;
    }

    const validated = SeedTopicBundleSchema.safeParse(parsedJson);
    if (!validated.success) {
      setErrorMsg(validated.error.issues[0]?.message ?? t('errors.generic'));
      return;
    }

    setBusy(true);
    try {
      const res = await apiRequest<BundleImportResult>('/exams/import', {
        method: 'POST',
        body: JSON.stringify({
          dryRun,
          ...(targetTopicId ? { targetTopicId } : {}),
          bundle: validated.data,
        }),
        retryRefresh: true,
      });

      if (dryRun) {
        setPreview(res);
      } else {
        onImported(res);
      }
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h2 id="import-modal-title" className="text-lg font-bold text-slate-900">
              {t('teacher.importModal.title')}
            </h2>
            <p className="text-xs text-slate-500">{t('teacher.importModal.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('app.close')}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}

          <div>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100">
              <FileUp className="h-4 w-4" />
              <span>{t('teacher.importModal.uploadFile')}</span>
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          </div>

          <div>
            <Label htmlFor="import-json-textarea">{t('teacher.importModal.pasteJson')}</Label>
            <textarea
              id="import-json-textarea"
              rows={8}
              dir="ltr"
              value={rawJson}
              onChange={(e) => {
                setRawJson(e.target.value);
                setPreview(null);
              }}
              className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-900 focus:border-brand-600 focus:outline-none"
              placeholder='{ "topic": { ... }, "models": [ ... ] }'
            />
          </div>

          {preview && (
            <Alert tone="info">
              <div className="space-y-1.5 font-medium">
                <div className="font-bold">
                  {preview.diff.mode === 'UPDATE_TOPIC'
                    ? t('teacher.importModal.diffModeUpdate')
                    : t('teacher.importModal.diffModeCreate')}
                </div>
                {preview.diff.models.map((m) => (
                  <div key={m.modelNumber}>
                    {t('teacher.importModal.modelDiffSummary', {
                      num: m.modelNumber,
                      added: m.addedOrderIndexes.length,
                      updated: m.updatedOrderIndexes.length,
                      removed: m.removedOrderIndexes.length,
                      prevPts: m.previousTotalPoints,
                      nextPts: m.nextTotalPoints,
                    })}
                  </div>
                ))}
              </div>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <Button variant="outline" onClick={onClose}>
              {t('app.cancel')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !rawJson.trim()}
              onClick={() => {
                void executeImport(true);
              }}
            >
              {t('teacher.importModal.runDryRun')}
            </Button>
            <Button
              disabled={busy || !rawJson.trim()}
              onClick={() => {
                void executeImport(false);
              }}
            >
              {t('teacher.importModal.applyImport')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
