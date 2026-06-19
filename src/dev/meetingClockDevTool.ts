import '@girs/gjs';

import St from '@girs/st-18';

import type { Module } from '~/module.ts';
import { MeetingClock } from '~/panel/clock/meetingClock/meetingClock.ts';
import type { MeetingEvent } from '~/panel/clock/meetingClock/meetingClockLogic.ts';

const DEVTOOL_SOURCE_KEY = 'aurora-devtool';
const DEV_MEETING_URL = 'https://meet.google.com/aur-ora-dev';

export class MeetingClockDevTool {
  readonly key = 'meeting-clock';
  readonly title = 'Meeting Clock';
  readonly iconName = 'x-office-calendar-symbolic';

  private _events: MeetingEvent[] = [];

  constructor(
    private readonly _getModule: (key: string) => Module | null,
    private readonly _requestMenuRebuild: () => void,
  ) {}

  buildPanel(): St.Widget {
    const meetingClock = this._getMeetingClock();
    const panel = new St.BoxLayout({
      vertical: true,
      style_class: 'aurora-devtool-module-panel',
    });

    const summary = new St.BoxLayout({
      style_class: 'aurora-devtool-summary',
    });
    summary.add_child(
      new St.Icon({
        icon_name: this.iconName,
        icon_size: 18,
        style_class: 'aurora-devtool-summary-icon',
      }),
    );
    summary.add_child(
      new St.Label({
        text: meetingClock
          ? `${this._events.length} fake meetings, ${meetingClock.eventCount} visible`
          : 'Meeting Clock disabled',
        style_class: 'aurora-devtool-summary-label',
        x_expand: true,
      }),
    );
    panel.add_child(summary);

    const firstRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    firstRow.add_child(
      this._createActionButton(
        'appointment-new-symbolic',
        'Add Soon',
        () => this.addSoonMeeting(),
        !meetingClock,
      ),
    );
    firstRow.add_child(
      this._createActionButton(
        'media-playback-start-symbolic',
        'Add Now',
        () => this.addCurrentMeeting(),
        !meetingClock,
      ),
    );
    panel.add_child(firstRow);

    const secondRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    secondRow.add_child(
      this._createActionButton(
        'insert-link-symbolic',
        'No Link',
        () => this.addNoLinkMeeting(),
        !meetingClock,
      ),
    );
    secondRow.add_child(
      this._createActionButton(
        'dialog-warning-symbolic',
        'Trigger Alert',
        () => this.triggerAlert(),
        !meetingClock,
      ),
    );
    panel.add_child(secondRow);

    const thirdRow = new St.BoxLayout({
      style_class: 'aurora-devtool-action-row',
    });
    thirdRow.add_child(
      this._createActionButton(
        'document-open-symbolic',
        'Open Calendar',
        () => this.openCalendar(),
        !meetingClock,
      ),
    );
    thirdRow.add_child(
      this._createActionButton(
        'user-trash-symbolic',
        'Clear Fake',
        () => this.clearMeetings(),
        !meetingClock || this._events.length === 0,
      ),
    );
    panel.add_child(thirdRow);

    return panel;
  }

  destroy(): void {
    this.clearMeetings();
  }

  addSoonMeeting(): string | null {
    return this._addMeeting('Dev meeting in 1 minute', 1, DEV_MEETING_URL);
  }

  addCurrentMeeting(): string | null {
    return this._addMeeting('Dev meeting now', -1, DEV_MEETING_URL);
  }

  addNoLinkMeeting(): string | null {
    return this._addMeeting('Dev event without link', 3, '');
  }

  triggerAlert(): boolean {
    const triggered = this._getMeetingClock()?.showAlert() ?? false;
    this._requestMenuRebuild();
    return triggered;
  }

  openCalendar(): boolean {
    return this._getMeetingClock()?.openMenu() ?? false;
  }

  clearMeetings(): void {
    this._events = [];
    this._getMeetingClock()?.clearSourceEvents(DEVTOOL_SOURCE_KEY);
    this._requestMenuRebuild();
  }

  get devMeetingCount(): number {
    return this._events.length;
  }

  get activeAlertEventId(): string | null {
    return this._getMeetingClock()?.activeAlertEventId ?? null;
  }

  private _getMeetingClock(): MeetingClock | null {
    const module = this._getModule('meeting-clock');
    return module instanceof MeetingClock ? module : null;
  }

  private _addMeeting(title: string, startsInMinutes: number, meetingUrl: string): string | null {
    const meetingClock = this._getMeetingClock();
    if (!meetingClock) return null;

    const now = Math.floor(Date.now() / 1000);
    const startEpochSeconds = now + Math.round(startsInMinutes * 60);
    const id = `aurora-dev-meeting-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const event: MeetingEvent = {
      id,
      title,
      startEpochSeconds,
      endEpochSeconds: startEpochSeconds + 30 * 60,
      sourceId: DEVTOOL_SOURCE_KEY,
      sourceName: 'Aurora DevTool',
      description: meetingUrl ? `Join: ${meetingUrl}` : '',
      location: meetingUrl,
      url: meetingUrl,
      meetingUrl,
      isAllDay: false,
    };

    this._events = [...this._events, event];
    meetingClock.setSourceEvents(DEVTOOL_SOURCE_KEY, this._events);
    this._requestMenuRebuild();
    return id;
  }

  private _createActionButton(
    iconName: string,
    label: string,
    onClick: () => void,
    disabled = false,
  ): St.Button {
    const content = new St.BoxLayout({
      style_class: 'aurora-devtool-action-content',
    });
    content.add_child(
      new St.Icon({
        icon_name: iconName,
        icon_size: 16,
      }),
    );
    content.add_child(new St.Label({ text: label }));

    const button = new St.Button({
      child: content,
      style_class: 'button aurora-devtool-action-button',
      can_focus: !disabled,
      reactive: !disabled,
      x_expand: true,
      accessible_name: label,
    });
    if (disabled) button.opacity = 120;
    button.connect('clicked', onClick);
    return button;
  }
}
