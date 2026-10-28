/**
 * Factor from the tracker's texture pixels to logical pixels.
 *
 * The Shell's own cursors report a scale of 1 but are rasterised at the monitor scale: a 32 px
 * arrow is a 64 px texture on a 2x monitor, and its logical size lives in a viewport that
 * extensions cannot read. Cursors that report another factor, such as a client cursor with a
 * buffer scale, already carry it.
 */
export function textureToLogical(trackerScale: number, monitorScale: number): number {
  return trackerScale === 1 ? 1 / monitorScale : trackerScale;
}
