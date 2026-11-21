// Two visual tiers. 'lite' keeps the phone budget (baked light only, small sky, no galleon, no post-processing);
// 'full' adds the galleon fly-in, bloom, light shafts and the richer sky. Override with ?tier=lite or ?tier=full.
// The guess errs towards 'full' only where the hardware says so; the quality governor in main.ts steps down live if
// frames still run long.
export type Tier = 'lite' | 'full';

// GPUs that cannot carry bloom + the full sky at phone/tablet resolutions, and software renderers
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|mali-(t\d|g[1-7]\d\b)|adreno[^\d]*([2-5]\d\d|6[0-1]\d)\b|powervr|videocore/i;

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

function detect(): Tier {
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (q === 'lite' || q === 'full') return q;
    const nav = navigator as { deviceMemory?: number; hardwareConcurrency?: number; connection?: { saveData?: boolean } };
    if (nav.connection?.saveData === true) return 'lite';
    const mem = nav.deviceMemory, cores = nav.hardwareConcurrency ?? 4;
    if (mem !== undefined && mem < 4) return 'lite';
    if (WEAK_GPU.test(gpuName())) return 'lite';
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (!coarse) return 'full';
    // touch screens: phones stay lite; tablets get the full tier only with the cores and memory to show for it
    const small = Math.min(screen.width, screen.height) < 700;
    if (small) return 'lite';
    return cores >= 6 && (mem === undefined || mem >= 6) ? 'full' : 'lite';
  } catch {
    return 'lite';
  }
}

export const TIER: Tier = detect();
export const FULL = TIER === 'full';
