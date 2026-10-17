/**
 * 图片压缩工具 — 将用户上传的图片压缩至约 200KB 后再 Base64 编码。
 * 使用 Canvas 缩放 + JPEG 质量压缩，动态调整质量参数。
 */

const TARGET_SIZE = 200 * 1024; // 200KB
const MAX_DIMENSION = 1920; // 长边最大像素
const MIN_DIMENSION = 1024; // 长边最小像素（质量不足时进一步缩小）
const MAX_QUALITY = 0.75;
const MIN_QUALITY = 0.35;

function base64Size(dataUrl: string): number {
  // Base64 Data URL 的实际字节数 ≈ (dataUrl.length - header) * 0.75
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl.length;
  return Math.round((dataUrl.length - comma - 1) * 0.75);
}

function compressByCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxDim: number,
  quality: number,
  mimeType: string
): string {
  let w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  let h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const ratio = Math.min(maxDim / Math.max(w, h), 1);
  w = Math.round(w * ratio);
  h = Math.round(h * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL(mimeType, quality);
}

export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // GIF/PNG 不含照片内容时保持原样，但仍做尺寸限制
    const isPhoto = file.type === 'image/jpeg' || file.type === 'image/jpg';

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // 若原图已经很小，直接返回
        const originalUrl = reader.result as string;
        if (base64Size(originalUrl) <= TARGET_SIZE) {
          resolve(originalUrl);
          return;
        }

        const mimeType = isPhoto ? 'image/jpeg' : file.type || 'image/jpeg';

        // 第一轮：maxDim=MAX_DIMENSION, quality=MAX_QUALITY
        let result = compressByCanvas(img, MAX_DIMENSION, MAX_QUALITY, mimeType);
        let currentSize = base64Size(result);

        // 若仍超过目标，逐步降 quality
        if (currentSize > TARGET_SIZE) {
          const steps = [
            { dim: MAX_DIMENSION, q: 0.6 },
            { dim: MAX_DIMENSION, q: 0.5 },
            { dim: MAX_DIMENSION, q: 0.4 },
            { dim: 1440, q: 0.55 },
            { dim: 1440, q: 0.45 },
            { dim: MIN_DIMENSION, q: 0.5 },
            { dim: MIN_DIMENSION, q: MIN_QUALITY },
          ];
          for (const step of steps) {
            result = compressByCanvas(img, step.dim, step.q, mimeType);
            currentSize = base64Size(result);
            if (currentSize <= TARGET_SIZE) break;
          }
        }

        resolve(result);
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
