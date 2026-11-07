import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotation } from '../../scripts/lib/workflow-commands.mjs';

// GitHub reads a workflow command up to the end of its line, and @actions/core escapes a message's
// %, CR and LF as %25, %0D and %0A (escapeData, packages/core/src/command.ts in actions/toolkit).
test('an annotation keeps its message on one line, escaped as GitHub\'s toolkit escapes it', () => {
  assert.equal(annotation('error', 'a 100% match\n::warning::forged\rline'), '::error::a 100%25 match%0A::warning::forged%0Dline');
  assert.equal(annotation('warning', 'plain'), '::warning::plain');
  assert.equal(annotation('notice', '%0A'), '::notice::%250A', 'an escape already in the text is not read as one');
});
