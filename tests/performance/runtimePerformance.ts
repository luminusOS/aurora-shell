import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import {
  createIconWeaveCandidateMetadata,
  scoreIconWeaveCandidate,
} from '~/patches/iconWeaveScoring.ts';
import { parseClipboardLog } from '~/clipboard/clipboardLog.ts';

type BenchmarkResult = {
  medianMs: number;
  p95Ms: number;
};

type ClipboardEntry = {
  id: string;
  kind: 'text' | 'image';
  text: string;
  pinned: boolean;
  timestamp: number;
  contentKey: string;
};

let checksum = 0;

function percentile(samples: number[], fraction: number): number {
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] || 0;
}

function sample(operation: () => number, samples: number[]): void {
  const started = performance.now();
  checksum += operation();
  samples.push(performance.now() - started);
}

function measureComparison(
  baselineOperation: () => number,
  optimizedOperation: () => number,
  sampleCount = 25,
): { baseline: BenchmarkResult; optimized: BenchmarkResult } {
  for (let index = 0; index < 5; index++) {
    checksum += baselineOperation();
    checksum += optimizedOperation();
  }

  const baselineSamples: number[] = [];
  const optimizedSamples: number[] = [];
  for (let index = 0; index < sampleCount; index++) {
    if (index % 2 === 0) {
      sample(baselineOperation, baselineSamples);
      sample(optimizedOperation, optimizedSamples);
    } else {
      sample(optimizedOperation, optimizedSamples);
      sample(baselineOperation, baselineSamples);
    }
  }

  const result = (samples: number[]): BenchmarkResult => ({
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  });

  return {
    baseline: result(baselineSamples),
    optimized: result(optimizedSamples),
  };
}

function parseClipboardLogBaseline(source: string) {
  const pinned: ClipboardEntry[] = [];
  const history: ClipboardEntry[] = [];
  const byId = new Map<string, ClipboardEntry>();

  for (const line of source.split('\n')) {
    if (!line) continue;

    const op = JSON.parse(line) as {
      op: 'add' | 'delete' | 'move' | 'pin' | 'unpin';
      id: string;
      text?: string;
      timestamp?: number;
    };
    if (op.op === 'add') {
      const entry: ClipboardEntry = {
        id: op.id,
        kind: 'text',
        text: op.text || '',
        pinned: false,
        timestamp: op.timestamp || 0,
        contentKey: op.text || '',
      };
      byId.set(entry.id, entry);
      history.unshift(entry);
      continue;
    }

    const entry = byId.get(op.id);
    if (!entry) continue;

    if (op.op === 'delete') {
      removeEntry(pinned, entry);
      removeEntry(history, entry);
      byId.delete(op.id);
    } else if (op.op === 'move') {
      moveToFront(entry.pinned ? pinned : history, entry);
    } else if (op.op === 'pin') {
      removeEntry(history, entry);
      entry.pinned = true;
      moveToFront(pinned, entry);
    } else {
      removeEntry(pinned, entry);
      entry.pinned = false;
      moveToFront(history, entry);
    }
  }

  return { pinned, history };
}

function removeEntry(entries: ClipboardEntry[], entry: ClipboardEntry): void {
  const index = entries.indexOf(entry);
  if (index !== -1) entries.splice(index, 1);
}

function moveToFront(entries: ClipboardEntry[], entry: ClipboardEntry): void {
  removeEntry(entries, entry);
  entries.unshift(entry);
}

function fragmentedClipboardLog(entryCount: number): string {
  const operations: string[] = [];
  for (let index = 1; index <= entryCount; index++) {
    operations.push(
      JSON.stringify({ op: 'add', id: String(index), text: `entry-${index}`, timestamp: index }),
    );
  }
  for (let index = 1; index <= entryCount; index++) {
    operations.push(JSON.stringify({ op: 'move', id: String(index) }));
  }
  return operations.join('\n');
}

function compactedClipboardLog(entryCount: number): string {
  const operations: string[] = [];
  for (let index = 1; index <= entryCount; index++) {
    operations.push(
      JSON.stringify({ op: 'add', id: String(index), text: `entry-${index}`, timestamp: index }),
    );
  }
  return operations.join('\n');
}

function gainPercent(baseline: number, optimized: number): number {
  return ((baseline - optimized) / baseline) * 100;
}

function benchmarkClipboard(size: number, fragmented: boolean): void {
  const source = fragmented ? fragmentedClipboardLog(size) : compactedClipboardLog(size);
  const baselineState = parseClipboardLogBaseline(source);
  const optimizedState = parseClipboardLog(source);
  assert.deepEqual(
    optimizedState.history.map((entry) => entry.id),
    baselineState.history.map((entry) => entry.id),
  );

  const { baseline, optimized } = measureComparison(
    () => parseClipboardLogBaseline(source).history.length,
    () => parseClipboardLog(source).history.length,
  );
  const gain = gainPercent(baseline.medianMs, optimized.medianMs);

  console.log(
    JSON.stringify({
      benchmark: 'clipboard-replay',
      path: fragmented ? 'fragmented' : 'compacted',
      operations: fragmented ? size * 2 : size,
      baseline,
      optimized,
      medianGainPercent: Number(gain.toFixed(1)),
    }),
  );

  if (size === 10_000)
    assert.ok(gain >= 20, `Clipboard median gain ${gain.toFixed(1)}% is below 20%`);
}

function benchmarkIconWeave(): void {
  const iterations = 100_000;
  const scoreInput = { wmClass: 'steam_app_220', appId: '', title: 'Half-Life 2' };
  const metadata = createIconWeaveCandidateMetadata(
    'com.valvesoftware.HalfLife2.desktop',
    'Half-Life 2',
    'steam steam://rungameid/220',
  );
  const { baseline, optimized } = measureComparison(
    () => {
      let score = 0;
      for (let index = 0; index < iterations; index++) {
        const candidate = createIconWeaveCandidateMetadata(
          'com.valvesoftware.HalfLife2.desktop',
          'Half-Life 2',
          'steam steam://rungameid/220',
        );
        score += scoreIconWeaveCandidate({ candidate, ...scoreInput });
      }
      return score;
    },
    () => {
      let score = 0;
      for (let index = 0; index < iterations; index++)
        score += scoreIconWeaveCandidate({ candidate: metadata, ...scoreInput });
      return score;
    },
  );
  const gain = gainPercent(baseline.medianMs, optimized.medianMs);

  console.log(
    JSON.stringify({
      benchmark: 'icon-weave-derived-metadata',
      path: 'warm-cache',
      operations: iterations,
      baseline,
      optimized,
      medianGainPercent: Number(gain.toFixed(1)),
    }),
  );
  assert.ok(gain >= 20, `IconWeave median gain ${gain.toFixed(1)}% is below 20%`);
}

console.log(
  JSON.stringify({
    benchmark: 'environment',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model || 'unknown',
    samples: 25,
  }),
);

for (const size of [1_000, 10_000]) {
  benchmarkClipboard(size, false);
  benchmarkClipboard(size, true);
}
benchmarkIconWeave();

if (checksum === 0) throw new Error('Benchmark output was not consumed');
