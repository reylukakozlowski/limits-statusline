// Snapshot fixtures shared by core and adapter tests. MOCKUP encodes the approved mockup;
// MOCKUP_LINES is the mockup as measured from its pixels (16-cell bars, the session line in the
// bar column, a min→max line for the context history), with the session line moved up to sit
// under the header so cost and runtime are read first, and the limit lines extended with the
// usage projected to the reset and the reset's clock time.

export const NOW = 1_800_000_000_000; // 2027-01-15 08:00 UTC, a Friday

export const MOCKUP = Object.freeze({
  nowMs: NOW,
  timeZone: 'UTC',
  project: 'daily-claude',
  git: { isRepo: false, branch: null, isDirty: false },
  modelName: 'Opus 5.5',
  costUsd: 20.33,
  durationMs: 20_400_000,
  cacheHitRatio: 0.99,
  promptCache: { warm: true, expiresAtMs: NOW + 3_120_000 },
  effort: 'xhigh',
  linesChanged: { added: 156, removed: 23 },
  context: { usedTokens: 543_000, windowTokens: 1_000_000, percent: 54 },
  contextHistory: [35, 36, 36, 40, 42, 45, 50, 54],
  limits: {
    sevenDay: { percentUsed: 39, resetsAtMs: NOW + 274_200_000 },
    fiveHour: { percentUsed: 12, resetsAtMs: NOW + 15_000_000 },
  },
  limitReadings: { fiveHour: [], sevenDay: [] },
});

export const MOCKUP_LINES = Object.freeze([
  'daily-claude | no git | ✦ Opus 5.5',
  '    $20.33 · 5h40m · cache 99% 52m · xhigh · +156 -23',
  'ctx ■■■■■■■■■□□□□□□□ 54%  543k/1.0M  ⣀⡠⠔⠊',
  '7d  ■■■■■■□□□□□□□□□□ 39% →  71%  ↻ 3d04h Mon 12:10  ↗ 0.4%/h',
  '5h  ■■□□□□□□□□□□□□□□ 12% →  72%  ↻ 4h10m 12:10      ↗ 14.4%/h',
]);

export const EMPTY = Object.freeze({
  nowMs: NOW,
  timeZone: null,
  project: null,
  git: null,
  modelName: null,
  costUsd: null,
  durationMs: null,
  cacheHitRatio: null,
  promptCache: null,
  effort: null,
  linesChanged: null,
  context: { usedTokens: null, windowTokens: null, percent: null },
  contextHistory: [],
  limits: { sevenDay: null, fiveHour: null },
  limitReadings: { fiveHour: [], sevenDay: [] },
});
