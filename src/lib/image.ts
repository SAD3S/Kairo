/** Réduit une image (vidéo, image ou fichier) en JPEG data URL, côté max `max` px. */
export function toJpeg(src: CanvasImageSource, w: number, h: number, max = 896, quality = 0.82): string {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export function fileToJpeg(file: File, max = 896): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(toJpeg(img, img.naturalWidth, img.naturalHeight, max));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}
