export type SniPixmap = { width: number; height: number; bytes: ArrayLike<number> };

export function selectSniPixmap<T extends Pick<SniPixmap, 'width' | 'height'>>(
  pixmaps: readonly T[],
  targetSize: number,
  minimumSize = 8,
): T | null {
  const usable = pixmaps.filter((p) => p.width >= minimumSize && p.height >= minimumSize);
  if (usable.length === 0) return null;

  return (
    [...usable].sort((a, b) => {
      const aDistance = Math.abs(Math.min(a.width, a.height) - targetSize);
      const bDistance = Math.abs(Math.min(b.width, b.height) - targetSize);
      return aDistance - bDistance || b.width * b.height - a.width * a.height;
    })[0] ?? null
  );
}

export function isSymbolicSniPixels(
  rgba: ArrayLike<number>,
  tolerance = 18,
  requiredRatio = 0.92,
): boolean {
  let opaque = 0;
  let neutral = 0;

  for (let index = 0; index + 3 < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) === 0) continue;

    opaque++;
    const red = rgba[index] ?? 0;
    const green = rgba[index + 1] ?? 0;
    const blue = rgba[index + 2] ?? 0;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) <= tolerance) {
      neutral++;
    }
  }

  return opaque > 0 && neutral / opaque >= requiredRatio;
}

export function isSymbolicSniArgb(
  argb: ArrayLike<number>,
  tolerance = 18,
  requiredRatio = 0.92,
): boolean {
  const rgba: number[] = [];

  for (let index = 0; index + 3 < argb.length; index += 4) {
    rgba.push(argb[index + 1] ?? 0, argb[index + 2] ?? 0, argb[index + 3] ?? 0, argb[index] ?? 0);
  }

  return isSymbolicSniPixels(rgba, tolerance, requiredRatio);
}
