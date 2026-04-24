type RGBA = [number, number, number, number];

const RED: [number, number, number] = [248, 90, 90];
const NEUTRAL: [number, number, number] = [226, 232, 240];
const GREEN: [number, number, number] = [97, 192, 128];
const INDIGO: [number, number, number] = [67, 82, 229];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Diverging red-neutral-green color scale centered on 0 if min < 0 < max,
 * otherwise a simple neutral-to-green ramp over [min,max].
 */
export function divergingColor(
  value: number,
  min: number,
  max: number,
  alpha = 200
): RGBA {
  if (min < 0 && max > 0) {
    if (value < 0) {
      const t = Math.max(0, Math.min(1, 1 - value / min));
      const [r, g, b] = lerpColor(RED, NEUTRAL, t);
      return [Math.round(r), Math.round(g), Math.round(b), alpha];
    }
    const t = Math.max(0, Math.min(1, value / max));
    const [r, g, b] = lerpColor(NEUTRAL, GREEN, t);
    return [Math.round(r), Math.round(g), Math.round(b), alpha];
  }
  const span = max - min || 1;
  const t = Math.max(0, Math.min(1, (value - min) / span));
  const [r, g, b] = lerpColor(NEUTRAL, GREEN, t);
  return [Math.round(r), Math.round(g), Math.round(b), alpha];
}

export function indigoFallbackColor(alpha = 200): RGBA {
  return [INDIGO[0], INDIGO[1], INDIGO[2], alpha];
}
