export type ClipboardEntrySnapshot = {
  id: string;
  kind: 'text' | 'image';
  text: string;
  pinned: boolean;
  timestamp: number;
  mimeType?: string;
  filePath?: string;
  contentKey: string;
};

export type ClipboardLogState = {
  pinned: ClipboardEntrySnapshot[];
  history: ClipboardEntrySnapshot[];
  nextId: number;
  wastedOps: number;
};

type AddOp = {
  op: 'add';
  id: string;
  kind?: 'text' | 'image';
  text: string;
  timestamp: number;
  mimeType?: string;
  filePath?: string;
  contentKey?: string;
};

type IdOp = {
  op: 'delete' | 'move' | 'pin' | 'unpin';
  id: string;
};

type ClipboardLogOp = AddOp | IdOp;

export function parseClipboardLog(source: string): ClipboardLogState {
  const pinned: ClipboardEntrySnapshot[] = [];
  const history: ClipboardEntrySnapshot[] = [];
  const byId = new Map<string, ClipboardEntrySnapshot>();
  let nextId = 1;
  let wastedOps = 0;

  for (const line of source.split('\n')) {
    if (!line) continue;

    let op: ClipboardLogOp;
    try {
      op = JSON.parse(line) as ClipboardLogOp;
    } catch {
      break;
    }

    if (op.op === 'add') {
      const entry: ClipboardEntrySnapshot = {
        id: op.id,
        kind: op.kind ?? 'text',
        text: op.text,
        pinned: false,
        timestamp: op.timestamp,
        contentKey: op.contentKey ?? op.text,
      };
      if (op.mimeType) entry.mimeType = op.mimeType;
      if (op.filePath) entry.filePath = op.filePath;
      byId.set(entry.id, entry);
      history.unshift(entry);
      nextId = Math.max(nextId, Number.parseInt(entry.id, 10) + 1 || nextId);
      continue;
    }

    const entry = byId.get(op.id);
    if (!entry) continue;

    if (op.op === 'delete') {
      removeEntry(pinned, entry);
      removeEntry(history, entry);
      byId.delete(op.id);
      wastedOps += 2;
    } else if (op.op === 'move') {
      const list = entry.pinned ? pinned : history;
      moveToFront(list, entry);
      wastedOps += 1;
    } else if (op.op === 'pin') {
      removeEntry(history, entry);
      entry.pinned = true;
      moveToFront(pinned, entry);
    } else if (op.op === 'unpin') {
      removeEntry(pinned, entry);
      entry.pinned = false;
      moveToFront(history, entry);
      wastedOps += 2;
    }
  }

  return { pinned, history, nextId, wastedOps };
}

export function encodeAddOp(entry: ClipboardEntrySnapshot): string {
  const op: AddOp = {
    op: 'add',
    id: entry.id,
    kind: entry.kind,
    text: entry.text,
    timestamp: entry.timestamp,
    contentKey: entry.contentKey,
  };
  if (entry.mimeType) op.mimeType = entry.mimeType;
  if (entry.filePath) op.filePath = entry.filePath;
  return encodeOp(op);
}

export function encodeDeleteOp(id: string): string {
  return encodeOp({ op: 'delete', id });
}

export function encodeMoveOp(id: string): string {
  return encodeOp({ op: 'move', id });
}

export function encodePinOp(id: string): string {
  return encodeOp({ op: 'pin', id });
}

export function encodeUnpinOp(id: string): string {
  return encodeOp({ op: 'unpin', id });
}

export function encodeCompactedLog(entries: ClipboardEntrySnapshot[]): string {
  return entries
    .flatMap((entry) =>
      entry.pinned ? [encodeAddOp(entry), encodePinOp(entry.id)] : [encodeAddOp(entry)],
    )
    .join('');
}

function encodeOp(op: ClipboardLogOp): string {
  return JSON.stringify(op) + '\n';
}

function removeEntry(list: ClipboardEntrySnapshot[], entry: ClipboardEntrySnapshot): void {
  const index = list.indexOf(entry);
  if (index !== -1) list.splice(index, 1);
}

function moveToFront(list: ClipboardEntrySnapshot[], entry: ClipboardEntrySnapshot): void {
  removeEntry(list, entry);
  list.unshift(entry);
}
