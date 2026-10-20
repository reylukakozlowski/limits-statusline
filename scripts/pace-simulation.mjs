// Monte Carlo comparison of pace look-backs for the 5-hour and 7-day plan windows, the evidence
// behind LIMIT_WINDOWS in src/core/limit-windows.mjs. Usage arrives in bursts (one per assistant
// turn), readings are quantized to 0.1% like the API's figures, and each estimator projects the
// usage at the reset every 5 minutes. Scored by the error of that projection against the usage
// actually reached, and by how often the colour is wrong (red when the window ends at or below
// 100%, or not red when it ends above). Deterministic: a fixed seed.
//
//   npm run simulate:pace

const RUNS_FIVE_HOUR = 300;
const RUNS_SEVEN_DAY = 40;
const QUANTUM_PERCENT = 0.1;
const TURN_GAP_MIN = 1.5;
const TURN_SPREAD = 0.9; // log-normal sigma of one turn's cost
const WARM_UP_MIN = 15;
const STEP_MIN = 5;

let seed = 42;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const exponential = (mean) => -Math.log(1 - random()) * mean;
const logNormal = (sigma) =>
  Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()) - (sigma * sigma) / 2);
const mod = (value, base) => ((value % base) + base) % base;

// rateAt(minute) → %/h while working, 0 while idle. Each turn bills what accrued since the last.
function simulate({ fromMin, toMin, rateAt }) {
  const readings = [];
  let used = 0;
  let nextTurn = fromMin + exponential(TURN_GAP_MIN);
  let pending = 0;
  for (let minute = fromMin; minute < toMin; minute += 1) {
    const rate = rateAt(minute);
    if (rate === 0) { pending = 0; continue; }
    pending += rate / 60;
    if (minute >= nextTurn) {
      used += pending * logNormal(TURN_SPREAD);
      pending = 0;
      readings.push([minute, Math.round(used / QUANTUM_PERCENT) * QUANTUM_PERCENT]);
      nextTurn = minute + exponential(TURN_GAP_MIN);
    }
  }
  return { readings, used };
}

// Cumulative usage on the straight line between the first `count` readings.
function valueAt(points, count, minute) {
  if (minute <= points[0][0]) return points[0][1];
  if (minute >= points[count - 1][0]) return points[count - 1][1];
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (points[middle][0] <= minute) low = middle; else high = middle;
  }
  const [t0, v0] = points[low];
  const [t1, v1] = points[high];
  return v0 + ((v1 - v0) * (minute - t0)) / (t1 - t0);
}

const lookBack = (minutes) => ({ points, count, now, historyStart }) => {
  const from = Math.max(historyStart, now - minutes);
  return (points[count - 1][1] - valueAt(points, count, from)) / ((now - from) / 60);
};
const ESTIMATORS = Object.freeze({
  average: ({ points, count, now }) => points[count - 1][1] / (now / 60), // since the window opened at 0
  last15m: lookBack(15),
  last30m: lookBack(30),
  last45m: lookBack(45),
  last60m: lookBack(60),
  last120m: lookBack(120),
  last6h: lookBack(360),
  last24h: lookBack(1440),
});

function evaluate({ windowMin, rateAt, estimators, runs, priorMin = 0 }) {
  const scores = Object.fromEntries(estimators.map((name) => [name, { squared: 0, wrong: 0, n: 0 }]));
  for (let run = 0; run < runs; run += 1) {
    // Readings of the day before the window opened continue the cumulative series down to 0.
    const prior = priorMin ? simulate({ fromMin: -priorMin, toMin: 0, rateAt }) : null;
    const priorPoints = prior ? [[-priorMin, -prior.used], ...prior.readings.map(([t, v]) => [t, v - prior.used])] : [];
    const { readings, used: final } = simulate({ fromMin: 0, toMin: windowMin, rateAt });
    const points = [...priorPoints, [0, 0], ...readings];
    let count = priorPoints.length + 1;
    for (let now = WARM_UP_MIN; now < windowMin; now += STEP_MIN) {
      while (count < points.length && points[count][0] <= now) count += 1;
      for (const name of estimators) {
        const rate = ESTIMATORS[name]({ points, count, now, historyStart: points[0][0] });
        const projected = points[count - 1][1] + Math.max(0, rate) * ((windowMin - now) / 60);
        const score = scores[name];
        score.squared += (projected - final) ** 2;
        score.wrong += (projected > 100) !== (final > 100) ? 1 : 0;
        score.n += 1;
      }
    }
  }
  return Object.fromEntries(Object.entries(scores).map(([name, { squared, wrong, n }]) =>
    [name, { rmse: Math.sqrt(squared / n), wrongColour: (100 * wrong) / n }]));
}

function report(title, results) {
  console.log(`\n${title}`);
  for (const [name, { rmse, wrongColour }] of Object.entries(results)) {
    console.log(`  ${name.padEnd(9)} error ${rmse.toFixed(1).padStart(5)} points   wrong colour ${wrongColour.toFixed(1).padStart(4)}% of the time`);
  }
}

const FIVE_HOUR_SCENARIOS = Object.freeze({
  'steady 20%/h': () => 20,
  '25%/h, stop after 90 min': (m) => (m < 90 ? 25 : 0),
  'idle 2 h, then 35%/h': (m) => (m < 120 ? 0 : 35),
  '30%/h, 10%/h after an hour': (m) => (m < 60 ? 30 : 10),
  '10%/h, 35%/h after 2 h': (m) => (m < 120 ? 10 : 35),
  '20 min on at 30%/h, 10 min off': (m) => (mod(m, 30) < 20 ? 30 : 0),
});
const FIVE_HOUR_ESTIMATORS = ['average', 'last15m', 'last30m', 'last45m', 'last60m', 'last120m'];
const totals = Object.fromEntries(FIVE_HOUR_ESTIMATORS.map((name) => [name, { rmse: 0, wrongColour: 0 }]));
for (const [title, rateAt] of Object.entries(FIVE_HOUR_SCENARIOS)) {
  const results = evaluate({ windowMin: 300, rateAt, estimators: FIVE_HOUR_ESTIMATORS, runs: RUNS_FIVE_HOUR });
  report(`5-hour window: ${title}`, results);
  for (const [name, { rmse, wrongColour }] of Object.entries(results)) {
    totals[name].rmse += rmse / Object.keys(FIVE_HOUR_SCENARIOS).length;
    totals[name].wrongColour += wrongColour / Object.keys(FIVE_HOUR_SCENARIOS).length;
  }
}
report('5-hour window: mean over the scenarios', totals);

// Workdays 09–13 and 14–18, weekends 10–12; the window opens on a Tuesday at 08:10.
const WEEK_MIN = 7 * 24 * 60;
const OPENS_AFTER_MONDAY_MIN = 24 * 60 + 8 * 60 + 10;
const workWeek = (perHour) => (m) => {
  const minuteOfWeek = mod(m + OPENS_AFTER_MONDAY_MIN, WEEK_MIN);
  const day = Math.floor(minuteOfWeek / 1440);
  const hour = (minuteOfWeek % 1440) / 60;
  if (day >= 5) return hour >= 10 && hour < 12 ? perHour : 0;
  return (hour >= 9 && hour < 13) || (hour >= 14 && hour < 18) ? perHour : 0;
};
for (const [title, perHour] of [['1.6%/h at work, about 70% a week', 1.6], ['2.5%/h at work, about 106% a week', 2.5]]) {
  report(`7-day window: ${title}`, evaluate({
    windowMin: WEEK_MIN, rateAt: workWeek(perHour), runs: RUNS_SEVEN_DAY, priorMin: 1440,
    estimators: ['average', 'last60m', 'last6h', 'last24h'],
  }));
}
