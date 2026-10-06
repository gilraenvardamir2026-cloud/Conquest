// How far apart two colours look, for normal vision and the three kinds of
// colour blindness (Machado et al. 2009, full severity). Used to warn when
// the two players pick colours someone could confuse.

type RGB = [number, number, number];

const SIM: Record<'protan' | 'deutan' | 'tritan', number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function parse(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(toLinear) as RGB;
}

function lab([r, g, b]: RGB): RGB {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const apply = (m: number[][], c: RGB): RGB => m.map((row) => clamp01(row[0] * c[0] + row[1] * c[1] + row[2] * c[2])) as RGB;
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The smallest colour difference (CIE76 ΔE) between a and b across normal and colour-blind vision. */
export function worstColorDistance(a: string, b: string): { delta: number; vision: string } {
  const A = parse(a);
  const B = parse(b);
  let worst = { delta: dist(lab(A), lab(B)), vision: 'normal vision' };
  for (const [k, m] of Object.entries(SIM)) {
    const d = dist(lab(apply(m, A)), lab(apply(m, B)));
    if (d < worst.delta) worst = { delta: d, vision: { protan: 'red-blindness', deutan: 'green-blindness', tritan: 'blue-blindness' }[k]! };
  }
  return worst;
}
