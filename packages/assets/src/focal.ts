import sharp from "sharp";

export type Focal = [number, number];
export interface CropBox { left: number; top: number; width: number; height: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Largest box of aspect `frameAspect` (width / height) inside the image, placed so the focal
 * point (0-1 fractions) is as central as the image edges allow. The focal point is always inside.
 */
export function cropBox(srcW: number, srcH: number, frameAspect: number, focal: Focal = [0.5, 0.5]): CropBox {
  if (!(srcW > 0 && srcH > 0 && frameAspect > 0)) throw new Error("cropBox: positive size and aspect required");
  let width = srcW;
  let height = Math.round(srcW / frameAspect);
  if (height > srcH) {
    height = srcH;
    width = Math.min(srcW, Math.round(srcH * frameAspect));
  }
  width = Math.max(1, width);
  height = Math.max(1, height);
  const fx = clamp01(focal[0]) * srcW;
  const fy = clamp01(focal[1]) * srcH;
  const left = Math.round(Math.min(srcW - width, Math.max(0, fx - width / 2)));
  const top = Math.round(Math.min(srcH - height, Math.max(0, fy - height / 2)));
  return { left, top, width, height };
}

/** Crop an image to the frame around the focal point. */
export async function cropToFrame(input: Buffer, frameAspect: number, focal: Focal = [0.5, 0.5]): Promise<Buffer> {
  const { data, info } = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  const b = cropBox(info.width, info.height, frameAspect, focal);
  return sharp(data).extract(b).toBuffer();
}

/**
 * Rule-based default focal point, no AI: sharp's attention strategy (saliency from saturation, skin
 * and edges), falling back to entropy, then to the centre. Returns [x, y] as 0-1 fractions.
 */
export async function defaultFocalPoint(input: Buffer): Promise<Focal> {
  try {
    const small = await sharp(input).rotate().resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true }).toBuffer();
    const meta = await sharp(small).metadata();
    const W = meta.width ?? 0, H = meta.height ?? 0;
    if (!W || !H) return [0.5, 0.5];
    // Crop to a square (a frame as tall as the image allows), let attention choose the window.
    const side = Math.min(W, H);
    const { info } = await sharp(small).resize(side, side, { fit: "cover", position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
    const ox = Math.abs(info.cropOffsetLeft ?? 0), oy = Math.abs(info.cropOffsetTop ?? 0);
    const x = W > side ? (ox + side / 2) / W : 0.5;
    const y = H > side ? (oy + side / 2) / H : 0.5;
    return [clamp01(x), clamp01(y)];
  } catch {
    return [0.5, 0.5];
  }
}
