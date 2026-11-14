import { Camera, Maximize2, RotateCw, Trash2, Upload, X } from 'lucide-react';
import * as React from 'react';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { apiRequest, getApiErrorMessage } from '@/lib/api';
import { prepareEssayImageForUpload } from '@/lib/imageClient';
import { useUiStore } from '@/store/uiStore';
import type { StudentAttemptImage } from '@/types/student';

interface EssayUploadWidgetProps {
  answerId: string;
  images: StudentAttemptImage[];
  disabled?: boolean;
  onChanged: (nextImages: StudentAttemptImage[]) => void;
}

const MAX_IMAGES = 2;
const MAX_BYTES = 8 * 1024 * 1024;

export function EssayUploadWidget({
  answerId,
  images,
  disabled = false,
  onChanged,
}: EssayUploadWidgetProps) {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);

  const [stagedFile, setStagedFile] = React.useState<File | null>(null);
  const [stagedPreviewUrl, setStagedPreviewUrl] = React.useState<string | null>(null);
  const [rotateDeg, setRotateDeg] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (stagedPreviewUrl) {
        URL.revokeObjectURL(stagedPreviewUrl);
      }
    };
  }, [stagedPreviewUrl]);

  const clearStaged = () => {
    if (stagedPreviewUrl) {
      URL.revokeObjectURL(stagedPreviewUrl);
    }
    setStagedFile(null);
    setStagedPreviewUrl(null);
    setRotateDeg(0);
  };

  const onDrop = React.useCallback(
    (
      acceptedFiles: File[],
      rejections: ReadonlyArray<{ errors: ReadonlyArray<{ message: string }> }>,
    ) => {
      setErrorMsg(null);
      if (rejections.length > 0) {
        setErrorMsg(
          locale === 'ar'
            ? 'نوع الملف غير مدعوم أو الحجم يتجاوز 8 ميجابايت.'
            : 'Unsupported file type or size exceeds 8 MB.',
        );
        return;
      }
      const file = acceptedFiles[0];
      if (!file) return;
      if (stagedPreviewUrl) {
        URL.revokeObjectURL(stagedPreviewUrl);
      }
      setStagedFile(file);
      setStagedPreviewUrl(URL.createObjectURL(file));
      setRotateDeg(0);
    },
    [locale, stagedPreviewUrl],
  );

  const canAddMore = !disabled && images.length < MAX_IMAGES;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled: !canAddMore || Boolean(stagedFile) || uploading,
    multiple: false,
    maxSize: MAX_BYTES,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif'],
    },
  });

  const handleConfirmUpload = async () => {
    if (!stagedFile) return;
    setErrorMsg(null);
    setUploading(true);
    try {
      const processed = await prepareEssayImageForUpload(stagedFile, rotateDeg);
      const formData = new FormData();
      formData.append('image', processed);

      const res = await apiRequest<{ image: StudentAttemptImage }>(
        `/student/answers/${answerId}/images`,
        {
          method: 'POST',
          body: formData,
          retryStudentRefresh: true,
        },
      );
      clearStaged();
      onChanged([...images, res.image]);
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    setErrorMsg(null);
    setDeletingId(imageId);
    try {
      await apiRequest<void>(`/student/answer-images/${imageId}`, {
        method: 'DELETE',
        retryStudentRefresh: true,
      });
      onChanged(images.filter((img) => img.id !== imageId));
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, locale, t('errors.generic')));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Alert tone="info" className="text-xs sm:text-sm">
        <div className="font-bold">{t('student.exam.photoGuideTitle')}</div>
        <p className="mt-1">{t('student.exam.photoGuideTips')}</p>
      </Alert>

      {errorMsg && <Alert tone="danger">{errorMsg}</Alert>}

      {stagedFile && stagedPreviewUrl && (
        <div className="space-y-3 rounded-xl border-2 border-brand-500 bg-brand-50/40 p-4">
          <div className="text-sm font-bold text-slate-800">{t('student.exam.previewStaged')}</div>
          <div className="flex justify-center overflow-hidden rounded-lg bg-slate-900/5 p-2">
            <img
              src={stagedPreviewUrl}
              alt="Staged handwritten preview"
              style={{ transform: `rotate(${rotateDeg}deg)` }}
              className="max-h-72 object-contain transition-transform"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRotateDeg((deg) => (deg + 90) % 360)}
              disabled={uploading}
            >
              <RotateCw className="h-4 w-4" />
              <span>{t('student.exam.rotate90')}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={clearStaged} disabled={uploading}>
              <span>{t('student.exam.retakePhoto')}</span>
            </Button>
            <Button
              size="sm"
              className="ms-auto"
              onClick={() => {
                void handleConfirmUpload();
              }}
              disabled={uploading}
            >
              <Upload className="h-4 w-4" />
              <span>{uploading ? t('student.exam.uploading') : t('student.exam.uploadPhoto')}</span>
            </Button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((img, idx) => (
            <div
              key={img.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="relative flex h-44 items-center justify-center bg-slate-100">
                <img
                  src={img.signedUrl}
                  alt={`Uploaded solution page ${idx + 1}`}
                  className="h-full w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => setLightboxUrl(img.signedUrl)}
                  aria-label="Zoom preview"
                  className="absolute bottom-2 end-2 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg bg-slate-900/75 text-white hover:bg-slate-900"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-600">
                <span dir="ltr">
                  {img.width}×{img.height} · {Math.max(1, Math.round(img.bytes / 1024))} KB
                </span>
                {!disabled && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deletingId === img.id}
                    onClick={() => {
                      void handleDeleteImage(img.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                    <span>{t('student.exam.deletePhoto')}</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length >= MAX_IMAGES ? (
        <p className="text-xs font-medium text-emerald-700">{t('student.exam.maxTwoPhotos')}</p>
      ) : (
        !stagedFile && (
          <div
            {...getRootProps()}
            className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
              isDragActive
                ? 'border-brand-600 bg-brand-50'
                : 'border-slate-300 bg-slate-50 hover:border-brand-500 hover:bg-slate-100'
            } ${!canAddMore ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input {...getInputProps()} aria-label={t('student.exam.dropzoneLabel')} />
            <Camera className="h-7 w-7 text-brand-600" />
            <p className="text-sm font-medium text-slate-700">{t('student.exam.dropzoneLabel')}</p>
          </div>
        )
      )}

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label={t('app.close')}
            className="fixed end-4 top-4 rounded-full bg-white/90 p-2 text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Full size solution"
            className="max-h-[90vh] max-w-full rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
