// @ts-nocheck
import { gettext as _ } from 'gettext';

import type { ExtensionContext } from '~/core/context.ts';
import { Module } from '~/module.ts';
import type { ModuleDefinition } from '~/moduleDefinition.ts';
import { ThumbnailDnDPatcher } from './thumbnailDnD.ts';

export class WorkspaceThumbnails extends Module {
  private _patcher: ThumbnailDnDPatcher | null = null;

  constructor(context: ExtensionContext) {
    super(context);
  }

  override enable(): void {
    this._patcher = new ThumbnailDnDPatcher();
    this._patcher.patch();
  }

  override disable(): void {
    this._patcher?.unpatch();
    this._patcher = null;
  }
}

export const definition: ModuleDefinition = {
  key: 'workspace-thumbnails',
  settingsKey: 'module-workspace-thumbnails',
  title: _('Workspace Thumbnails DnD'),
  subtitle: _('Drag windows between workspaces from the overview side panel'),
  factory: (ctx) => new WorkspaceThumbnails(ctx),
};
