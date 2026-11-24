// Monte Carlo comparison of ways to tell the time until the 7-day limit reaches 100%, the
// evidence behind `minWorkSpanMs` in src/core/limit-windows.mjs and the pace of work in
// src/core/pace.mjs ("B1 work pace 24 h" below). Shaped after two days of real readings
// (22-23 Nov 2026): usage reported in whole percents, work in blocks, about 2.2%/h while working
// (one percent every 11-45 minutes) against 0.3%/h over the whole day. Each estimator is asked
// every 5 minutes of work in weeks that reach 100%, and scored against the work that was really
// left and against the time on the clock: the median error, the typical factor it is off by,
// and how often it is more than twice too late or too early. Deterministic: a fixed seed.
//
//   npm run simulate:limit-time            # percents rounded down
//   npm run simulate:limit-time -- round   # percents rounded to the nearest
//
// Read with the percents rounded down (2026-11-24), last hour of work, against the work left:
// the clock average of 24 hours is off by a factor of 5.6 and more than twice too late 95% of
// the time; the pace of work over 24 hours by 1.4 and 13%. Looking back 48 hours or the whole
// week is no better. Placing the usage inside its percent helps only if the percents are
// rounded down and hurts if they are rounded, which Claude Code's documentation does not say.
// No estimator tells the time on the clock well: it depends on when the next break comes.

const DISPLAY = process.argv[2] === 'round' ? Math.round : Math.floor;
const RUNS = 150;
const WEEK = 7 * 1440;
const OPEN_HOUR = 7; // the window opens at 07:00
const TURN_GAP_MIN = 1.5;
const TURN_SPREAD = 0.9;
const BLOCK_SPREAD = 0.4; // log-normal sigma of a work block's pace
const BUCKET = 5;
const FIVE_HOUR = 300;

let seed = 20261124;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const uniform = (a, b) => a + (b - a) * random();
const exponential = (mean) => -Math.log(1 - random()) * mean;
const logNormal = (sigma) =>
  Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()) - (sigma * sigma) / 2);

// A scenario returns the work blocks of one day as [startHour, endHour] on the clock.
const SCENARIOS = {
  'office 9-13, 14-18, short weekends': (day) => (day % 7 >= 5 ? [[10, 12]] : [[9, 13], [14, 18]]),
  'irregular blocks every day': () => {
    const blocks = [];
    if (random() < 0.8) { const s = uniform(9, 11.5); blocks.push([s, s + uniform(0.5, 4)]); }
    if (random() < 0.6) { const s = uniform(14, 16); blocks.push([s, s + uniform(0.5, 2.5)]); }
    if (random() < 0.7) { const s = uniform(19, 22); blocks.push([s, s + uniform(0.3, 2.5)]); }
    return blocks;
  },
  'evenings 19-23, long weekends': (day) => (day % 7 >= 5 ? [[10, 13], [15, 20]] : [[19, 23]]),
  'light start, heavy end of the week': (day) => (day < 3 ? [[10, 12]] : [[9, 13], [14, 19], [20, 23]]),
};

function simulateWeek(dayBlocks) {
  // Minute 0 is the window's opening at OPEN_HOUR; days are clock days counted from that morning.
  const blockOf = new Int16Array(WEEK).fill(-1);
  const blocks = [];
  for (let day = 0; day < 8; day += 1) {
    for (const [from, to] of dayBlocks(day)) {
      const start = Math.round(day * 1440 + (from - OPEN_HOUR) * 60);
      const end = Math.round(day * 1440 + (to - OPEN_HOUR) * 60);
      const id = blocks.push(logNormal(BLOCK_SPREAD)) - 1;
      for (let m = Math.max(0, start); m < Math.min(WEEK, end); m += 1) blockOf[m] = id;
    }
  }
  let scheduled = 0;
  for (let m = 0; m < WEEK; m += 1) if (blockOf[m] >= 0) scheduled += 1;
  const target = uniform(105, 170); // percent the week would reach without a limit
  const basePace = target / (scheduled / 60);
  const fiveHourFactor = uniform(4, 6); // 5-hour points per weekly point, unknown to the estimators

  const points = []; // weekly readings [minute, shown]
  const shownAt = new Int16Array(WEEK); // weekly figure on screen
  const stepAt = new Int32Array(WEEK); // minute the figure on screen last rose
  const activePrefix = new Float32Array(WEEK + 1); // minutes of observed activity so far
  const fivePrefix = new Float32Array(WEEK + 1); // sum of the rises of the 5-hour figure so far
  const turnBuckets = new Uint8Array(Math.ceil(WEEK / BUCKET) + 1);
  let used = 0;
  let pending = 0;
  let nextTurn = 0;
  let shown = 0;
  let lastStep = 0;
  let previousBlock = -1;
  let enteredBlock = -1;
  let fiveStart = -Infinity;
  let fiveBase = 0;
  let fiveShown = 0;
  let fiveTotal = 0;
  let hit = -1;
  for (let m = 0; m < WEEK; m += 1) {
    const block = blockOf[m];
    if (block >= 0 && hit < 0) {
      if (block !== enteredBlock) { enteredBlock = block; nextTurn = m + exponential(TURN_GAP_MIN); }
      pending += (basePace * blocks[block]) / 60;
      if (m >= nextTurn) {
        used += pending * logNormal(TURN_SPREAD);
        pending = 0;
        nextTurn = m + exponential(TURN_GAP_MIN);
        turnBuckets[Math.floor(m / BUCKET)] = 1;
        if (m - fiveStart >= FIVE_HOUR) { fiveStart = m; fiveBase = used; fiveShown = 0; }
        const five = Math.min(100, DISPLAY(fiveHourFactor * (used - fiveBase)));
        if (five > fiveShown) { fiveTotal += five - fiveShown; fiveShown = five; }
        const now = Math.min(100, DISPLAY(used));
        const firstOfBlock = block !== previousBlock;
        if (now > shown) { shown = now; lastStep = m; points.push([m, shown]); } else if (firstOfBlock) points.push([m, shown]);
        previousBlock = block;
        if (used >= 100) hit = m;
      }
    }
    shownAt[m] = shown;
    stepAt[m] = lastStep;
    fivePrefix[m + 1] = fiveTotal;
    activePrefix[m + 1] = activePrefix[m] + (turnBuckets[Math.floor(m / BUCKET)] ? 1 : 0);
  }
  const truePrefix = new Float32Array(WEEK + 1);
  for (let m = 0; m < WEEK; m += 1) truePrefix[m + 1] = truePrefix[m] + (blockOf[m] >= 0 ? 1 : 0);
  return { points, shownAt, stepAt, activePrefix, fivePrefix, truePrefix, blockOf, hit };
}

// The weekly figure at `minute` on the straight line between the readings known at `now`.
function valueAt(points, now, minute) {
  let low = 0;
  let high = points.length - 1;
  if (points.length === 0 || minute <= 0) return 0;
  while (low < high) { const mid = (low + high + 1) >> 1; if (points[mid][0] <= minute) low = mid; else high = mid - 1; }
  if (points[low][0] > minute) return (points[low][0] <= now ? points[low][1] : 0) * (minute / points[low][0]);
  const next = points[low + 1];
  if (!next || next[0] > now) return points[low][1];
  return points[low][1] + ((next[1] - points[low][1]) * (minute - points[low][0])) / (next[0] - points[low][0]);
}

const DAY = 1440;
const clockAverage = (lookBack) => ({ week, t }) => {
  const from = Math.max(0, t - lookBack);
  const rate = (week.shownAt[t] - valueAt(week.points, t, from)) / (t - from);
  return (100 - week.shownAt[t]) / rate;
};
const activeMinutes = (week, from, to) => week.activePrefix[to + 1] - week.activePrefix[Math.max(0, from)];
const workPace = (week, t, lookBack) => {
  const from = Math.max(0, t - lookBack);
  return (week.shownAt[t] - valueAt(week.points, t, from)) / Math.max(1, activeMinutes(week, from, t));
};
// How far into the current percent the usage is, from the work done since the figure last rose.
const insideByTime = (week, t, pace) => Math.min(0.95, activeMinutes(week, week.stepAt[t], t) * pace);
// The same from the 5-hour figure, whose points are several times finer.
const insideByFiveHour = (week, t) => {
  const weeklyRise = week.shownAt[t];
  const factor = weeklyRise > 0 ? week.fivePrefix[t + 1] / (weeklyRise + 0.5) : 5;
  return Math.min(0.95, (week.fivePrefix[t + 1] - week.fivePrefix[week.stepAt[t] + 1]) / factor);
};
// Per-percent work time, exponentially smoothed: the newest steps weigh most.
const smoothedPace = (week, t, alpha) => {
  let pace = null;
  let previous = null;
  for (const [minute, shown] of week.points) {
    if (minute > t) break;
    if (previous && shown > previous[1]) {
      const sample = (shown - previous[1]) / Math.max(1, activeMinutes(week, previous[0], minute));
      pace = pace === null ? sample : alpha * sample + (1 - alpha) * pace;
    }
    if (!previous || shown > previous[1]) previous = [minute, shown];
  }
  return pace ?? workPace(week, t, WEEK);
};
// Clock time: the work pace laid over the hours of the day worked in so far this week.
const profileForward = ({ week, t }) => {
  const pace = workPace(week, t, WEEK);
  const share = new Float32Array(24);
  const days = Math.max(1, t / DAY);
  for (let m = 0; m < t; m += 1) if (week.activePrefix[m + 1] > week.activePrefix[m]) share[Math.floor((m % DAY) / 60)] += 1 / 60 / days;
  let left = 100 - week.shownAt[t] - insideByTime(week, t, pace);
  for (let m = t; m < t + WEEK; m += 1) {
    const working = m - t < 30 ? 1 : Math.min(1, share[Math.floor((m % DAY) / 60)]);
    left -= pace * working;
    if (left <= 0) return m - t;
  }
  return Infinity;
};

const ESTIMATORS = {
  'A0 clock average 24 h (now)': clockAverage(DAY),
  'A1 clock average 6 h': clockAverage(360),
  'A2 clock average 1 h': clockAverage(60),
  'B1 work pace 24 h': ({ week, t }) => (100 - week.shownAt[t]) / workPace(week, t, DAY),
  'B2 work pace 48 h': ({ week, t }) => (100 - week.shownAt[t]) / workPace(week, t, 2 * DAY),
  'B3 work pace whole week': ({ week, t }) => (100 - week.shownAt[t]) / workPace(week, t, WEEK),
  'C1 B1 + position by time': ({ week, t }) => { const p = workPace(week, t, DAY); return (100 - week.shownAt[t] - insideByTime(week, t, p)) / p; },
  'C2 B2 + position by time': ({ week, t }) => { const p = workPace(week, t, 2 * DAY); return (100 - week.shownAt[t] - insideByTime(week, t, p)) / p; },
  'C3 B3 + position by time': ({ week, t }) => { const p = workPace(week, t, WEEK); return (100 - week.shownAt[t] - insideByTime(week, t, p)) / p; },
  'D1 smoothed steps 0.3 + position': ({ week, t }) => { const p = smoothedPace(week, t, 0.3); return (100 - week.shownAt[t] - insideByTime(week, t, p)) / p; },
  'D2 smoothed steps 0.1 + position': ({ week, t }) => { const p = smoothedPace(week, t, 0.1); return (100 - week.shownAt[t] - insideByTime(week, t, p)) / p; },
  'E1 B2 + position by 5-hour': ({ week, t }) => { const p = workPace(week, t, 2 * DAY); return (100 - week.shownAt[t] - insideByFiveHour(week, t)) / p; },
  'F1 hours-of-day profile (clock)': profileForward,
};

const HORIZONS = [['last hour of work', 5, 60], ['1-3 h of work left', 60, 180], ['3-10 h of work left', 180, 600]];
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function evaluate(dayBlocks) {
  const samples = {};
  for (let run = 0; run < RUNS; run += 1) {
    const week = simulateWeek(dayBlocks);
    if (week.hit < 0) continue;
    for (let t = DAY; t < week.hit; t += 5) {
      if (week.blockOf[t] < 0 || week.shownAt[t] < 50) continue;
      const truthWork = week.truePrefix[week.hit] - week.truePrefix[t];
      const truthClock = week.hit - t;
      for (const [name, estimate] of Object.entries(ESTIMATORS)) {
        const predicted = Math.max(0.5, estimate({ week, t }));
        for (const [horizon, from, to] of HORIZONS) {
          if (truthWork < from || truthWork >= to) continue;
          ((samples[horizon] ??= {})[name] ??= []).push([predicted, truthWork, truthClock]);
        }
      }
    }
  }
  return samples;
}

function summarize(rows, truthIndex) {
  const ratios = rows.map((row) => row[0] / row[truthIndex]).sort((a, b) => a - b);
  const errors = rows.map((row) => Math.abs(row[0] - row[truthIndex])).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    medianError: quantile(errors, 0.5),
    typicalFactor: Math.exp(quantile(ratios.map((r) => Math.abs(Math.log(r))).sort((a, b) => a - b), 0.5)),
    tooLate: (100 * ratios.filter((r) => r > 2).length) / ratios.length,
    tooEarly: (100 * ratios.filter((r) => r < 0.5).length) / ratios.length,
    p10: quantile(ratios, 0.1),
    p90: quantile(ratios, 0.9),
  };
}

const overall = {};
for (const dayBlocks of Object.values(SCENARIOS)) {
  const samples = evaluate(dayBlocks);
  for (const [horizon, byName] of Object.entries(samples)) {
    for (const [name, rows] of Object.entries(byName)) {
      for (const [truthName, index] of [['work', 1], ['clock', 2]]) {
        const s = summarize(rows, index);
        const bucket = ((overall[`${horizon} | truth: ${truthName} time`] ??= {})[name] ??= { n: 0, medianError: 0, typicalFactor: 0, tooLate: 0, tooEarly: 0, p10: 0, p90: 0 });
        bucket.n += 1;
        for (const key of Object.keys(s)) bucket[key] += s[key];
      }
    }
  }
}
console.log(`display: ${DISPLAY.name}; mean over ${Object.keys(SCENARIOS).length} scenarios, ${RUNS} weeks each`);
for (const [title, byName] of Object.entries(overall)) {
  console.log(`\n${title}`);
  console.log('  estimator                          median error   typical factor   >2x too late   >2x too early   ratio p10..p90');
  for (const [name, b] of Object.entries(byName)) {
    const v = (key) => b[key] / b.n;
    console.log(`  ${name.padEnd(34)} ${v('medianError').toFixed(0).padStart(8)} min   x${v('typicalFactor').toFixed(2).padStart(6)}   ${v('tooLate').toFixed(0).padStart(11)}%   ${v('tooEarly').toFixed(0).padStart(12)}%   ${v('p10').toFixed(2)}..${v('p90').toFixed(2)}`);
  }
}
