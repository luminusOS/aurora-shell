import {
  PREVIEW_IMAGE_EDGE,
  PREVIEW_IMAGE_MAX_BYTES,
  type PreviewImageType,
} from './linkPreviewImageFormat.ts';

export const IMAGE_SANDBOX_EXECUTABLES = [
  '/usr/bin/bwrap',
  '/usr/bin/prlimit',
  '/usr/bin/python3',
] as const;

const ADDRESS_SPACE_BYTES = 512 * 1024 * 1024;
const TEMPORARY_SPACE_BYTES = 8 * 1024 * 1024;

const DECODE = `
import sys
import gi

gi.require_version('GdkPixbuf', '2.0')
from gi.repository import GdkPixbuf

limit = ${PREVIEW_IMAGE_MAX_BYTES}
edge = ${PREVIEW_IMAGE_EDGE}
data = sys.stdin.buffer.read(limit + 1)
if not 0 < len(data) <= limit:
    sys.exit(1)

loader = GdkPixbuf.PixbufLoader.new_with_mime_type(sys.argv[1])
oversized = False
def check_size(loader, width, height):
    global oversized
    oversized = not (0 < width <= 4096 and 0 < height <= 4096 and width * height <= 12000000)
    if oversized:
        loader.set_size(1, 1)

loader.connect('size-prepared', check_size)
loader.write(data)
loader.close()
image = loader.get_pixbuf()
if oversized or image is None or not loader.get_animation().is_static_image():
    sys.exit(1)

width, height = image.get_width(), image.get_height()
side = min(width, height)
square = image.new_subpixbuf((width - side) // 2, (height - side) // 2, side, side)
scaled = square.scale_simple(edge, edge, GdkPixbuf.InterpType.BILINEAR)
rgba = scaled if scaled.get_has_alpha() else scaled.add_alpha(False, 0, 0, 0)
pixels = rgba.get_pixels()
stride = rgba.get_rowstride()
for row in range(edge):
    start = row * stride
    sys.stdout.buffer.write(pixels[start:start + edge * 4])
`;

export function imageSandboxArgs(mimeType: PreviewImageType): string[] {
  const [bubblewrap, prlimit, python] = IMAGE_SANDBOX_EXECUTABLES;
  return [
    bubblewrap,
    '--unshare-all',
    '--unshare-user',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    '--cap-drop',
    'ALL',
    '--setenv',
    'PATH',
    '/usr/bin',
    '--setenv',
    'HOME',
    '/tmp',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--size',
    String(TEMPORARY_SPACE_BYTES),
    '--tmpfs',
    '/tmp',
    '--chdir',
    '/tmp',
    '--',
    prlimit,
    `--as=${ADDRESS_SPACE_BYTES}:${ADDRESS_SPACE_BYTES}`,
    '--cpu=1:2',
    '--core=0:0',
    '--fsize=67108864:67108864',
    '--',
    python,
    '-I',
    '-c',
    DECODE,
    mimeType,
  ];
}
