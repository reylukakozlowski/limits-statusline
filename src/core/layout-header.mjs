// The header line: project | git branch | model. The model comes last, and a surface cuts a line
// at its end, so a header too wide for the surface gives up the start of the branch first (its
// end tells the branches of one project apart), then the end of the project.

import { DASH } from './format.mjs';
import { lineText, segment, separator } from './layout-segments.mjs';
import { TONE } from './thresholds.mjs';

const ELLIPSIS = '…';
const SHORTEST_NAME = 8; // a branch or project is cut no shorter than this, the ellipsis included

/**
 * @param {{ project: string | null, git: import('./git-status.mjs').GitState | null, modelName: string | null }} snapshot
 * @param {number | null} width the surface's width in cells, null when unknown: nothing is cut
 * @returns {import('./layout-segments.mjs').Line}
 */
export function headerLine({ project, git, modelName }, width) {
  const draw = (projectName, branch) => [
    segment(projectName, TONE.accent),
    separator(' | '),
    gitSegment(git, branch),
    separator(' | '),
    segment(`✦ ${modelName ?? DASH}`, TONE.model),
  ];
  const names = { project: project ?? DASH, branch: git?.branch ?? DASH };
  const excess = () => (width === null ? 0 : lineText(draw(names.project, names.branch)).length - width);
  if (git?.isRepo) names.branch = shortened(names.branch, excess(), (text, length) => `${ELLIPSIS}${text.slice(-length)}`);
  names.project = shortened(names.project, excess(), (text, length) => `${text.slice(0, length)}${ELLIPSIS}`);
  return draw(names.project, names.branch);
}

/** `text` shorter by `excess` characters, as far as SHORTEST_NAME allows; `cut` keeps `length` of it. */
function shortened(text, excess, cut) {
  if (excess <= 0 || text.length <= SHORTEST_NAME) return text;
  return cut(text, Math.max(SHORTEST_NAME, text.length - excess) - ELLIPSIS.length);
}

function gitSegment(git, branch) {
  if (!git?.isRepo) return segment('no git', TONE.muted);
  return segment(`git ${branch}${git.isDirty ? '*' : ''}`);
}
