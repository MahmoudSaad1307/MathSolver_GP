import imageCompression from 'browser-image-compression';

async function rotateViaCanvas(file: File, degrees: number): Promise<File> {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    const swapDims = normalized === 90 || normalized === 270;
    canvas.width = swapDims ? img.height : img.width;
    canvas.height = swapDims ? img.width : img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((normalized * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) {
      return file;
    }

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareEssayImageForUpload(file: File, degrees = 0): Promise<File> {
  const rotated = await rotateViaCanvas(file, degrees);
  try {
    const compressed = await imageCompression(rotated, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 1600,
      useWebWorker: false,
      fileType: 'image/jpeg',
    });
    return new File([compressed], rotated.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: compressed.type || 'image/jpeg',
    });
  } catch {
    // Fallback in non-canvas environments (e.g., jsdom tests): server still re-encodes via sharp.
    return rotated;
  }
}
