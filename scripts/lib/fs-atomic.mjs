// Write-then-rename, so a crash never leaves a half-written settings.json behind.

import fs from 'node:fs';
import { dirname } from 'node:path';

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** @param {string} path @param {string} text */
export function writeFileAtomic(path, text) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  try {
    fs.renameSync(temporary, path);
  } catch (error) {
    // Windows refuses the rename while another process (an editor, an antivirus scan) holds
    // the target open; copying over it still works there.
    if (!LOCKED.has(error.code)) throw error;
    fs.copyFileSync(temporary, path);
    fs.unlinkSync(temporary);
  }
}
