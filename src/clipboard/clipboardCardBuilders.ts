import '@girs/gjs';
import { gettext as _ } from '~/shared/i18n.ts';

import Clutter from '@girs/clutter-18';
import St from '@girs/st-18';

import type { ClipboardEntry } from './clipboardStore.ts';
import { highlightCodeMarkup } from './codeHighlight.ts';
import { truncateClipboardText } from './clipboardCardState.ts';
import { CodeCardOverlayLayout, FloatingActionsLayout } from './clipboardCardLayouts.ts';

const MAX_LABEL_CHARS = 360;
const MAX_CODE_LINES = 5;

export function buildImageCard(entry: ClipboardEntry, actions: St.BoxLayout): St.Widget {
  const overlay = new St.Widget({
    layout_manager: new FloatingActionsLayout(),
    x_expand: true,
    y_expand: true,
    style_class: 'aurora-clipboard-image-overlay',
  });

  const content = new St.Widget({
    layout_manager: new Clutter.BinLayout(),
    x_expand: true,
    y_expand: true,
  });

  if (!entry.filePath) {
    content.add_child(
      new St.Icon({
        icon_name: 'image-missing-symbolic',
        icon_size: 28,
        style_class: 'aurora-clipboard-image-missing',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      }),
    );
  }

  actions.add_style_class_name('aurora-clipboard-image-actions');
  overlay.add_child(content);
  overlay.add_child(actions);

  return overlay;
}

export function buildLinkCard(
  parsed: { host: string; path: string },
  actions: St.BoxLayout,
): St.Widget {
  const root = new St.Widget({
    layout_manager: new FloatingActionsLayout(),
    x_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    style_class: 'aurora-clipboard-item-link-overlay',
  });

  const row = new St.BoxLayout({
    orientation: Clutter.Orientation.HORIZONTAL,
    x_expand: true,
    style_class: 'aurora-clipboard-item-content',
  });

  const body = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
    style_class: 'aurora-clipboard-item-body',
  });

  const title = new St.Label({
    text: parsed.host,
    style_class: 'aurora-clipboard-item-link-title',
    x_expand: true,
  });
  title.clutter_text.ellipsize = 3;
  body.add_child(title);

  const path = parsed.path && parsed.path !== '/' ? parsed.path : '';
  const urlLabel = new St.Label({
    text: parsed.host + path,
    style_class: 'aurora-clipboard-item-meta',
    x_expand: true,
  });
  urlLabel.clutter_text.ellipsize = 3;
  body.add_child(urlLabel);

  row.add_child(body);
  root.add_child(row);
  root.add_child(actions);

  return root;
}

export function buildCodeCard(entry: ClipboardEntry, actions: St.BoxLayout): St.Widget {
  const overlay = new St.Widget({
    layout_manager: new CodeCardOverlayLayout(),
    x_expand: true,
    y_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    y_align: Clutter.ActorAlign.FILL,
    style_class: 'aurora-clipboard-item-code-overlay',
  });

  const content = new St.BoxLayout({
    orientation: Clutter.Orientation.HORIZONTAL,
    x_expand: true,
    y_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    y_align: Clutter.ActorAlign.FILL,
    style_class: 'aurora-clipboard-item-content',
  });

  const allLines = entry.text.split('\n');
  const shownLines = allLines.slice(0, MAX_CODE_LINES);
  const codeRow = new St.BoxLayout({
    orientation: Clutter.Orientation.HORIZONTAL,
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
    style_class: 'aurora-clipboard-item-code',
  });

  const gutter = new St.Label({
    text: shownLines.map((_line, index) => String(index + 1)).join('\n'),
    style_class: 'aurora-clipboard-item-code-gutter',
    y_align: Clutter.ActorAlign.START,
  });
  codeRow.add_child(gutter);

  const code = new St.Label({
    style_class: 'aurora-clipboard-item-code-label',
    x_expand: true,
    y_align: Clutter.ActorAlign.START,
  });
  code.clutter_text.set_line_wrap(false);
  code.clutter_text.ellipsize = 3;
  code.clutter_text.set_markup(highlightCodeMarkup(shownLines.join('\n')));
  codeRow.add_child(code);

  content.add_child(codeRow);
  overlay.add_child(content);
  overlay.add_child(actions);

  if (allLines.length > MAX_CODE_LINES) {
    overlay.add_child(
      new St.Label({
        text: _('%d lines').format(allLines.length),
        style_class: 'aurora-clipboard-item-code-badge',
      }),
    );
  }

  return overlay;
}

export function buildTextCard(entry: ClipboardEntry, actions: St.BoxLayout): St.Widget {
  const overlay = new St.Widget({
    layout_manager: new FloatingActionsLayout(),
    request_mode: Clutter.RequestMode.HEIGHT_FOR_WIDTH,
    x_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    style_class: 'aurora-clipboard-item-text-overlay',
  });

  const textBody = new St.Bin({
    x_align: Clutter.ActorAlign.START,
    style_class: 'aurora-clipboard-item-text-body',
  });
  const normalizedText = entry.text.replace(/\s+/g, ' ').trim();
  const label = new St.Label({
    text: truncateClipboardText(normalizedText, MAX_LABEL_CHARS),
    style_class: 'aurora-clipboard-item-label',
    x_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    y_align: Clutter.ActorAlign.START,
  });
  label.clutter_text.set_line_wrap(true);
  label.clutter_text.set_single_line_mode(false);
  label.clutter_text.ellipsize = 0;

  textBody.set_child(label);
  overlay.add_child(textBody);
  overlay.add_child(actions);

  return overlay;
}
