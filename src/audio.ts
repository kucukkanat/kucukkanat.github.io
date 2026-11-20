// The sound front lives in ./sound/facade.ts; the synth engine (./sound/engine.ts) loads only when sound is turned on.
export { audio } from './sound/facade';
export type { Mode } from './sound/facade';
