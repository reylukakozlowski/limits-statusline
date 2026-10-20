// Defensive readers for loosely typed input (stdin JSON, mods API answers).

/** @param {unknown} value @returns {number | null} */
export const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** @param {unknown} value @returns {string | null} non-blank strings only */
export const textOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** @param {unknown} value @returns {Record<string, any>} the object, or {} for anything else */
export const recordOf = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});
