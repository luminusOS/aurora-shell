import Clutter from '@girs/clutter-18';
import St from '@girs/st-18';
import { Slider } from '@girs/gnome-shell/ui/slider';

import { gettext as _ } from '~/shared/i18n.ts';
import type { AnnotationTool } from '~/capture/annotationModel.ts';
import { createIcon } from '~/shared/icons.ts';

export const CAPTURE_COLORS = [
  '#ffffff',
  '#000000',
  '#e01b24',
  '#ff8800',
  '#ffdd00',
  '#44cc44',
  '#4488ff',
  '#aa44ff',
] as const;
export const CAPTURE_WIDTH_MIN = 1;
export const CAPTURE_WIDTH_MAX = 16;
const TOOLS: ReadonlyArray<{ tool: AnnotationTool; icon: string; label: string }> = [
  { tool: 'select', icon: 'selection-opaque-3-symbolic', label: _('Selection') },
  { tool: 'pointer', icon: 'pointer-primary-click-symbolic', label: _('Pointer') },
  { tool: 'freehand', icon: 'document-edit-symbolic', label: _('Freehand') },
  { tool: 'rectangle', icon: 'square-outline-thick-symbolic', label: _('Rectangle') },
  { tool: 'solid-rectangle', icon: 'square-filled-symbolic', label: _('Solid rectangle') },
  { tool: 'highlighter', icon: 'marker-symbolic', label: _('Highlighter') },
  { tool: 'arrow', icon: 'arrow1-top-right-symbolic', label: _('Arrow') },
  { tool: 'text', icon: 'text-insert2-symbolic', label: _('Text') },
  { tool: 'stamp', icon: 'one-circle-symbolic', label: _('Numbered marker') },
];

export type CaptureToolbarCallbacks = {
  beginDrag(handle: St.Button, event: Clutter.Event): boolean;
  moveDrag(event: Clutter.Event): boolean;
  releaseDrag(event: Clutter.Event): boolean;
  selectTool(tool: AnnotationTool): void;
  selectColor(color: string): void;
  setWidth(width: number): void;
  undo(): void;
  clear(): void;
};

export type CaptureToolbarActors = {
  actor: St.BoxLayout;
  toolButtons: Map<AnnotationTool, St.Button>;
  colorButtons: Map<string, St.Button>;
  widthSlider: Slider;
};

export function createCaptureToolbar(
  initialWidth: number,
  callbacks: CaptureToolbarCallbacks,
): CaptureToolbarActors {
  const actor = new St.BoxLayout({
    style_class: 'screenshot-ui-panel capture-tools-toolbar',
    reactive: true,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.START,
    y_expand: true,
  });
  const toolButtons = new Map<AnnotationTool, St.Button>();
  const colorButtons = new Map<string, St.Button>();

  const drag = iconButton('list-drag-handle-symbolic', _('Move toolbar'));
  drag.add_style_class_name('capture-tools-drag-handle');
  drag.connect('button-press-event', (_actor, event) => callbacks.beginDrag(drag, event));
  drag.connect('motion-event', (_actor, event) => callbacks.moveDrag(event));
  drag.connect('button-release-event', (_actor, event) => callbacks.releaseDrag(event));
  actor.add_child(drag);

  for (const [index, definition] of TOOLS.entries()) {
    const button = iconButton(definition.icon, definition.label, true);
    button.add_style_class_name(`capture-tools-tool-${definition.tool}`);
    button.connect('clicked', () => callbacks.selectTool(definition.tool));
    actor.add_child(button);
    toolButtons.set(definition.tool, button);
    if (index === 1) {
      actor.add_child(separator());
    }
  }

  actor.add_child(separator());

  for (const color of CAPTURE_COLORS) {
    const button = new St.Button({
      style_class: 'capture-tools-ring-button',
      accessible_name: `${_('Annotation color')}: ${color}`,
      child: new St.Widget({
        style_class: 'capture-tools-swatch',
        style: `background-color: ${color};`,
      }),
      toggle_mode: true,
      can_focus: true,
    });
    button.connect('clicked', () => callbacks.selectColor(color));
    actor.add_child(button);
    colorButtons.set(color, button);
  }

  actor.add_child(separator());

  const boundedWidth = Math.max(CAPTURE_WIDTH_MIN, Math.min(CAPTURE_WIDTH_MAX, initialWidth));
  const widthSlider = new Slider(
    (boundedWidth - CAPTURE_WIDTH_MIN) / (CAPTURE_WIDTH_MAX - CAPTURE_WIDTH_MIN),
  );
  widthSlider.add_style_class_name('capture-tools-width-slider');
  widthSlider.accessible_name = _('Annotation width');
  widthSlider.y_align = Clutter.ActorAlign.CENTER;
  widthSlider.connect('notify::value', () =>
    callbacks.setWidth(
      CAPTURE_WIDTH_MIN + widthSlider.value * (CAPTURE_WIDTH_MAX - CAPTURE_WIDTH_MIN),
    ),
  );
  actor.add_child(widthSlider);
  actor.add_child(separator());

  const undo = iconButton('edit-undo-symbolic', _('Undo'));
  undo.connect('clicked', callbacks.undo);
  actor.add_child(undo);

  const clear = iconButton('user-trash-symbolic', _('Clear annotations'));
  clear.connect('clicked', callbacks.clear);
  actor.add_child(clear);

  return { actor, toolButtons, colorButtons, widthSlider };
}

export function iconButton(icon: string, label: string, toggle = false): St.Button {
  return new St.Button({
    style_class: 'screenshot-ui-type-button capture-tools-button',
    child: createIcon(icon),
    accessible_name: label,
    toggle_mode: toggle,
    can_focus: true,
  });
}

function separator(): St.Widget {
  return new St.Widget({ style_class: 'capture-tools-separator', y_expand: true });
}
