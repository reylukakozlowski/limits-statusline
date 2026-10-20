// Hooks module (mod) entry: the band above the prompt in the Claude desktop app.
import { registerBand } from '../src/desktop/band.mjs';

export function register(on, options) {
  registerBand(on, options);
}
