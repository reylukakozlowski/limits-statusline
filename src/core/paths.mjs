// Path helpers that must work on Windows and POSIX paths alike, whatever platform runs them.

/** Last path segment, or null. @param {unknown} path */
export function folderName(path) {
  if (typeof path !== 'string') return null;
  return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? null;
}
