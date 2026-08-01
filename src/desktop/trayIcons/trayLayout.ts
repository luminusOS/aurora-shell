export type TrayLayoutInput = {
  count: number;
  itemWidth: number;
  gap: number;
  configuredLimit: number;
  availableWidth: number | null;
  collapsed: boolean;
};

export type TrayLayout = {
  fullWidth: number;
  effectiveLimit: number;
  hasOverflow: boolean;
  reservedWidth: number;
  viewportWidth: number;
  clipStart: number;
  maxScroll: number;
};

export function getEffectiveTrayLimit(
  configuredLimit: number,
  itemWidth: number,
  gap: number,
  availableWidth: number | null,
): number {
  const configured = Math.max(1, Math.floor(configuredLimit));
  if (availableWidth === null) return configured;

  const stride = Math.max(1, itemWidth + gap);

  return Math.max(
    1,
    Math.min(configured, Math.floor((Math.max(0, availableWidth) + gap) / stride)),
  );
}

export function calculateTrayLayout(input: TrayLayoutInput): TrayLayout {
  const count = Math.max(0, Math.floor(input.count));
  const itemWidth = Math.max(0, input.itemWidth);
  const gap = Math.max(0, input.gap);
  const fullWidth = count * itemWidth + Math.max(0, count - 1) * gap;
  const effectiveLimit = getEffectiveTrayLimit(
    input.configuredLimit,
    itemWidth,
    gap,
    input.availableWidth,
  );
  const hasOverflow = count > effectiveLimit;
  const visibleCount = Math.min(count, effectiveLimit);
  const naturalCollapsedWidth = visibleCount * itemWidth + Math.max(0, visibleCount - 1) * gap;
  const reservedWidth =
    input.availableWidth === null
      ? fullWidth
      : Math.min(fullWidth, Math.max(0, input.availableWidth));
  const collapsedWidth = Math.min(naturalCollapsedWidth, reservedWidth);
  const maxScroll = Math.max(0, fullWidth - collapsedWidth);

  return {
    fullWidth,
    effectiveLimit,
    hasOverflow,
    reservedWidth,
    viewportWidth: Math.round(input.collapsed ? collapsedWidth : reservedWidth),
    clipStart: Math.round(input.collapsed ? Math.max(0, reservedWidth - collapsedWidth) : 0),
    maxScroll,
  };
}

export function visibleTrayIndexes(
  count: number,
  limit: number,
  scrollOffset: number,
  itemWidth: number,
  gap: number,
): { start: number; end: number } {
  const safeCount = Math.max(0, Math.floor(count));
  const safeLimit = Math.max(1, Math.floor(limit));
  const hiddenCount = Math.max(0, safeCount - safeLimit);
  const stride = itemWidth + gap;
  const start =
    stride > 0
      ? Math.max(0, Math.min(hiddenCount, Math.round(Math.max(0, scrollOffset) / stride)))
      : hiddenCount;
  return { start, end: Math.min(safeCount, start + safeLimit) };
}
