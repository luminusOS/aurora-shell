import '@girs/gjs';

import type St from '@girs/st-18';

import {
  createDevToolActionButton,
  createDevToolActionRow,
  createDevToolModulePanel,
  createDevToolSummary,
} from '~/dev/devToolUi.ts';
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
    const panel = createDevToolModulePanel();
    panel.add_child(
      createDevToolSummary(
        this.iconName,
        meetingClock
          ? `${this._events.length} fake meetings, ${meetingClock.eventCount} visible`
          : 'Meeting Clock disabled',
      ),
    );

    const firstRow = createDevToolActionRow();
    firstRow.add_child(
      createDevToolActionButton(
        'appointment-new-symbolic',
        'Add Soon',
        () => this.addSoonMeeting(),
        !meetingClock,
      ),
    );
    firstRow.add_child(
      createDevToolActionButton(
        'media-playback-start-symbolic',
        'Add Now',
        () => this.addCurrentMeeting(),
        !meetingClock,
      ),
    );
    panel.add_child(firstRow);

    const secondRow = createDevToolActionRow();
    secondRow.add_child(
      createDevToolActionButton(
        'insert-link-symbolic',
        'No Link',
        () => this.addNoLinkMeeting(),
        !meetingClock,
      ),
    );
    secondRow.add_child(
      createDevToolActionButton(
        'dialog-warning-symbolic',
        'Trigger Alert',
        () => this.triggerAlert(),
        !meetingClock,
      ),
    );
    panel.add_child(secondRow);

    const thirdRow = createDevToolActionRow();
    thirdRow.add_child(
      createDevToolActionButton(
        'document-open-symbolic',
        'Open Calendar',
        () => this.openCalendar(),
        !meetingClock,
      ),
    );
    thirdRow.add_child(
      createDevToolActionButton(
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
    const meetingClock = this._getMeetingClock();
    if (!meetingClock) return false;

    const triggered = meetingClock.showAlert();
    this._requestMenuRebuild();
    return triggered;
  }

  openCalendar(): boolean {
    const meetingClock = this._getMeetingClock();
    if (!meetingClock) return false;

    return meetingClock.openMenu();
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
    const meetingClock = this._getMeetingClock();
    if (!meetingClock) return null;

    return meetingClock.activeAlertEventId;
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
}
