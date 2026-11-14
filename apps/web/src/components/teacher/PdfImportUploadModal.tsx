import { FileText, Upload, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import type { PdfImportJobResponse } from '@/types/content';

interface PdfImportUploadModalProps {
  targetTopic?: { id: string; title: string };
  onClose: () => void;
  onJobCreated: (jobId: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function PdfImportUploadModal({
  targetTopic,
  onClose,
  onJobCreated,
}: PdfImportUploadModalProps) {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);

  const [preFile, setPreFile] = React.useState<File | null>(null);
  const [postFile, setPostFile] = React.useState<File | null>(null);
  const [topicTitle, setTopicTitle] = React.useState('');
  const [topicDescription, setTopicDescription] = React.useState('');
  const [threshold, setThreshold] = React.useState('0.6');
  const [preTitle, setPreTitle] = React.useState('النموذج القبلي (Pre-Model)');
  const [postTitle, setPostTitle] = React.useState('النموذج البعدي (Post-Model)');
  const [preDuration, setPreDuration] = React.useState('60');
  const [postDuration, setPostDuration] = React.useState('60');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!preFile && !postFile) {
      setError(t('pdfImport.missingPdfError'));
      return;
    }
    if (!targetTopic && topicTitle.trim().length < 2) {
      setError(t('pdfImport.missingTopicTitleError'));
      return;
    }

    const fd = new FormData();
    if (preFile) fd.append('prePdf', preFile);
    if (postFile) fd.append('postPdf', postFile);
    if (targetTopic) {
      fd.append('topicId', targetTopic.id);
    } else {
      fd.append(
        'topicMeta',
        JSON.stringify({
          title: topicTitle.trim(),
          description: topicDescription.trim(),
          correctnessThreshold: Number(threshold) || 0.6,
        }),
      );
    }
    fd.append('preTitle', preTitle.trim() || 'النموذج القبلي (Pre-Model)');
    fd.append('postTitle', postTitle.trim() || 'النموذج البعدي (Post-Model)');
    fd.append('preDurationMinutes', String(Math.max(5, Number(preDuration) || 60)));
    fd.append('postDurationMinutes', String(Math.max(5, Number(postDuration) || 60)));

    setSubmitting(true);
    try {
      const res = await apiRequest<{ job: PdfImportJobResponse }>('/pdf-imports', {
        method: 'POST',
        body: fd,
      });
      onJobCreated(res.job.id);
    } catch (err) {
      setError(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-import-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="pdf-import-modal-title" className="text-xl font-bold text-slate-900">
              {t('pdfImport.modalTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t('pdfImport.modalSubtitle')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          {targetTopic ? (
            <Alert tone="info">
              {t('pdfImport.forExistingTopic', { title: targetTopic.title })}
            </Alert>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div>
                <Label htmlFor="pdf-topic-title">{t('pdfImport.topicTitle')}</Label>
                <Input
                  id="pdf-topic-title"
                  value={topicTitle}
                  onChange={(e) => setTopicTitle(e.target.value)}
                  placeholder={t('pdfImport.topicTitlePlaceholder')}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pdf-topic-desc">{t('pdfImport.topicDescription')}</Label>
                  <Input
                    id="pdf-topic-desc"
                    value={topicDescription}
                    onChange={(e) => setTopicDescription(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pdf-topic-threshold">{t('pdfImport.threshold')}</Label>
                  <Input
                    id="pdf-topic-threshold"
                    type="number"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">{t('pdfImport.fileHint')}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Pre-Model PDF dropzone */}
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FileText className="h-4 w-4 text-brand-600" />
                <span>{t('pdfImport.prePdfLabel')}</span>
              </div>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-xs text-slate-600 hover:border-brand-500 hover:bg-brand-50/30">
                <Upload className="mb-1.5 h-5 w-5 text-slate-500" />
                <span>{t('pdfImport.choosePdf')}</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label={t('pdfImport.prePdfLabel')}
                  className="sr-only"
                  onChange={(e) => setPreFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {preFile && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  <span className="truncate font-medium">
                    {preFile.name} ({formatFileSize(preFile.size)})
                  </span>
                  <button
                    type="button"
                    className="font-semibold text-brand-700 hover:underline"
                    onClick={() => setPreFile(null)}
                  >
                    {t('pdfImport.removeFile')}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label htmlFor="pre-title">{t('pdfImport.preModelTitle')}</Label>
                  <Input
                    id="pre-title"
                    value={preTitle}
                    onChange={(e) => setPreTitle(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="pre-dur">{t('pdfImport.durationMinutes')}</Label>
                  <Input
                    id="pre-dur"
                    type="number"
                    min="5"
                    max="300"
                    value={preDuration}
                    onChange={(e) => setPreDuration(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Post-Model PDF dropzone */}
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FileText className="h-4 w-4 text-brand-600" />
                <span>{t('pdfImport.postPdfLabel')}</span>
              </div>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-xs text-slate-600 hover:border-brand-500 hover:bg-brand-50/30">
                <Upload className="mb-1.5 h-5 w-5 text-slate-500" />
                <span>{t('pdfImport.choosePdf')}</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label={t('pdfImport.postPdfLabel')}
                  className="sr-only"
                  onChange={(e) => setPostFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {postFile && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
                  <span className="truncate font-medium">
                    {postFile.name} ({formatFileSize(postFile.size)})
                  </span>
                  <button
                    type="button"
                    className="font-semibold text-brand-700 hover:underline"
                    onClick={() => setPostFile(null)}
                  >
                    {t('pdfImport.removeFile')}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label htmlFor="post-title">{t('pdfImport.postModelTitle')}</Label>
                  <Input
                    id="post-title"
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="post-dur">{t('pdfImport.durationMinutes')}</Label>
                  <Input
                    id="post-dur"
                    type="number"
                    min="5"
                    max="300"
                    value={postDuration}
                    onChange={(e) => setPostDuration(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('pdfImport.uploading') : t('pdfImport.startExtraction')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
