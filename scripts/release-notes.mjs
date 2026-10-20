// Prints the CHANGELOG.md section of one version: node scripts/release-notes.mjs v0.1.0
// Used by .github/workflows/release.yml as the GitHub release body.
import { readFileSync } from 'node:fs';
import { extractReleaseNotes } from './lib/release-lib.mjs';

try {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  process.stdout.write(`${extractReleaseNotes(changelog, process.argv[2] ?? '')}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
