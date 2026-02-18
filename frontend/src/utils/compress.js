const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

/**
 * Compress an image File on the client using canvas.
 * Resizes to max 1600px on longest edge, converts to JPEG at quality 0.85.
 * Returns a new File object with the compressed data.
 */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      const longest = Math.max(width, height);

      if (longest > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const stem = file.name.replace(/\.[^.]+$/, '');
          const compressed = new File([blob], `${stem}.jpg`, {
            type: 'image/jpeg',
            lastModified: file.lastModified,
          });
          resolve(compressed);
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}

/**
 * Compress an array of image Files in parallel.
 */
export async function compressImages(files) {
  return Promise.all(files.map(compressImage));
}
