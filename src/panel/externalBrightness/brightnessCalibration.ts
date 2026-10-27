export type BrightnessRange = { min: number; max: number };

export function parseBrightnessRange(minimum: string, maximum: string): BrightnessRange | null {
  if (!/^\d+$/.test(minimum.trim()) || !/^\d+$/.test(maximum.trim())) return null;

  const min = Number(minimum);
  const max = Number(maximum);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || min >= max || max > 65535)
    return null;

  return { min, max };
}
