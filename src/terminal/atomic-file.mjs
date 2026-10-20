// Writing a whole file so that a reader never sees half of it: a temporary file per process,
// renamed over the target.

import fs from 'node:fs';

/** @param {string} file @param {string} content */
export function writeAtomic(file, content) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}
