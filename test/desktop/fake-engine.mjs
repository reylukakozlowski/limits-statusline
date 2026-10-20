// A stand-in for the parts of the mods API the band's sources use: environment variables, a file
// system of strings, the session id and the settings. Not a test file: the runner's glob is
// `*.test.mjs`.

/**
 * @param {{ env?: Record<string, string>, files?: Record<string, string>, settings?: object, sessionId?: string }} [setup]
 */
export function fakeEngine({ env = { USERPROFILE: 'C:/Users/dev' }, files = {}, settings = {}, sessionId = 'session-1' } = {}) {
  const written = [];
  const $ = {
    env: { get: async (name) => env[name] },
    fs: {
      exists: async (path) => Object.hasOwn(files, path),
      read: async (path) => {
        if (!Object.hasOwn(files, path)) throw new Error('ENOENT');
        return files[path];
      },
      write: async (path, text) => {
        files[path] = text;
        written.push(path);
      },
    },
    session: { id: async () => sessionId },
    settings: { read: async () => settings },
  };
  return { $, files, written };
}

/** A 5-hour window as `$.session.usage()` and `session.measure` report it. */
export const fiveHour = (percentUsed, resetsAtMs) => ({ kind: 'five_hour', percentUsed, resetsAt: new Date(resetsAtMs).toISOString() });
