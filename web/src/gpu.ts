// SH-13 (PRD §10.8): pick the splat budget and DPR cap from the WebGL renderer string. No imports so node --test can load it.

/** Discrete NVIDIA/AMD cards. Apple, Intel and AMD APUs ("Radeon(TM) Graphics", no model number) are integrated. */
export function isDiscreteGPU(renderer: string): boolean {
  if (/apple|intel|radeon(\(tm\))? graphics/i.test(renderer)) return false;
  return /nvidia|geforce|quadro|rtx|amd|radeon/i.test(renderer);
}

/** Spark LoD splat budget: 1.5M on Apple/integrated GPUs, 2.5M on discrete ones. */
export function lodBudget(discrete: boolean): number {
  return discrete ? 2_500_000 : 1_500_000;
}

/** Unmasked renderer string, e.g. "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, ...)"; '' if hidden. */
export function gpuRendererString(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return (info && gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) || '';
}
