/** RGBImage → canvas 渲染与检测结果叠加 */
import type { LocatedPatch, RGBImage } from '../core/types.ts';

export function renderRgbToCanvas(
  img: RGBImage,
  host: HTMLElement,
  scale = 1,
  located?: LocatedPatch[],
): HTMLCanvasElement {
  host.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(img.width, img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    imageData.data[j] = img.data[i];
    imageData.data[j + 1] = img.data[i + 1];
    imageData.data[j + 2] = img.data[i + 2];
    imageData.data[j + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  if (located) overlayBoxes(ctx, located);
  canvas.style.width = `${Math.round(img.width * scale)}px`;
  host.append(canvas);
  return canvas;
}

function overlayBoxes(ctx: CanvasRenderingContext2D, located: LocatedPatch[]): void {
  ctx.lineWidth = 2;
  ctx.font = '11px sans-serif';
  for (const p of located) {
    const x = p.cx - p.w / 2;
    const y = p.cy - p.h / 2;
    ctx.strokeStyle = '#3b9dff';
    ctx.strokeRect(x, y, p.w, p.h);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    const tw = ctx.measureText(p.spec.label).width + 8;
    ctx.fillRect(x, y - 14, tw, 13);
    ctx.fillStyle = '#9cc8ff';
    ctx.fillText(p.spec.label, x + 4, y - 4);
  }
}
