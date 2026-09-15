/**
 * Decorative candlestick backdrop for the landing hero.
 *
 * Drawn rather than photographed: sharp at any size, a few KB, and no
 * licensing question. Generated from a fixed seed so the server and the
 * browser render identical markup and nothing reflows between loads.
 *
 * Built in two planes — a large blurred set behind and a sharp set in front —
 * which is what gives a photograph its depth of field. A single flat layer of
 * candles reads as a diagram; two planes read as a scene.
 *
 * It is texture, not evidence: no axis, no figures, and hidden from assistive
 * technology.
 */

const WIDTH = 1200;
const HEIGHT = 760;

/**
 * Mulberry32 — a small deterministic generator.
 *
 * `Math.random()` would differ between server and client, which React reports
 * as a hydration mismatch.
 */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candle {
  x: number;
  open: number;
  close: number;
  high: number;
  low: number;
  up: boolean;
}

/**
 * A series with real structure — a decline, a base, a recovery, then a stall.
 *
 * Deliberately not a clean rally. Big prominent candles marching up and to the
 * right on a trading page read as a performance claim, and this product makes
 * none. Swings give the artwork its drama instead.
 */
function buildSeries(count: number, seed: number, amplitude: number) {
  const rand = seeded(seed);
  const slot = WIDTH / count;

  const candles: Candle[] = [];
  const closes: number[] = [];
  let price = 0.52;
  let drift = 0;

  for (let i = 0; i < count; i++) {
    const phase = i / count;

    // A slow shape underneath the noise: down, base, up, stall.
    const shape =
      Math.sin(phase * Math.PI * 1.65 - 0.9) * 0.16 * amplitude +
      Math.sin(phase * Math.PI * 3.1) * 0.05 * amplitude;

    drift = drift * 0.6 + (rand() - 0.5) * 0.06 * amplitude;

    const open = price;
    const target = 0.5 + shape;
    const close = Math.min(0.94, Math.max(0.06, open + drift + (target - open) * 0.28));
    const wick = (0.02 + rand() * 0.05) * amplitude;

    candles.push({
      x: i * slot + slot / 2,
      open,
      close,
      high: Math.max(open, close) + wick * (0.4 + rand()),
      low: Math.min(open, close) - wick * (0.4 + rand()),
      up: close >= open,
    });

    closes.push(close);
    price = close;
  }

  const window = 5;
  const path = closes
    .map((_, i) => {
      const slice = closes.slice(Math.max(0, i - window + 1), i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      return `${(i * slot + slot / 2).toFixed(1)},${((1 - mean) * HEIGHT).toFixed(1)}`;
    })
    .join(' L');

  return { candles, slot, average: `M${path}` };
}

// Far plane: fewer, larger, blurred. Near plane: the ones in focus.
const far = buildSeries(14, 91177, 1.25);
const near = buildSeries(26, 20260916, 1.0);

function Candles({
  data,
  bodyRatio,
  strokeWidth,
  solidOpacity,
  hollowOpacity,
  wickOpacity,
}: {
  data: ReturnType<typeof buildSeries>;
  bodyRatio: number;
  strokeWidth: number;
  solidOpacity: number;
  hollowOpacity: number;
  wickOpacity: number;
}) {
  const y = (v: number) => (1 - v) * HEIGHT;
  const body = data.slot * bodyRatio;

  return (
    <>
      {data.candles.map((c, i) => (
        <g key={i}>
          <line
            x1={c.x}
            x2={c.x}
            y1={y(c.high)}
            y2={y(c.low)}
            stroke="#0b1220"
            strokeWidth={strokeWidth}
            opacity={wickOpacity}
          />
          {/* Solid for down, hollow for up — the monochrome convention, so it
              reads without relying on colour. */}
          <rect
            x={c.x - body / 2}
            y={y(Math.max(c.open, c.close))}
            width={body}
            height={Math.max(3, Math.abs(y(c.open) - y(c.close)))}
            rx={1}
            fill={c.up ? '#ffffff' : '#0b1220'}
            stroke="#0b1220"
            strokeWidth={strokeWidth}
            opacity={c.up ? hollowOpacity : solidOpacity}
          />
        </g>
      ))}
    </>
  );
}

export function CandlesBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-[78%] select-none md:block"
      style={{
        // Fades out over the headline on the left, and softens at the top and
        // bottom so it never meets an edge.
        maskImage:
          'linear-gradient(to right, transparent 4%, rgba(0,0,0,0.28) 28%, rgba(0,0,0,0.78) 58%, black 84%), linear-gradient(to bottom, transparent 0%, black 16%, black 80%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent 4%, rgba(0,0,0,0.28) 28%, rgba(0,0,0,0.78) 58%, black 84%), linear-gradient(to bottom, transparent 0%, black 16%, black 80%, transparent 100%)',
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        role="presentation"
      >
        <defs>
          <filter id="tos-depth" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        {/* Price grid, barely there. */}
        {[0.18, 0.36, 0.54, 0.72, 0.9].map((t) => (
          <line
            key={t}
            x1={0}
            x2={WIDTH}
            y1={t * HEIGHT}
            y2={t * HEIGHT}
            stroke="#0b1220"
            strokeWidth="1"
            opacity="0.05"
          />
        ))}

        {/* Far plane — big, soft, out of focus. */}
        <g filter="url(#tos-depth)" opacity="0.2">
          <Candles
            data={far}
            bodyRatio={0.5}
            strokeWidth={4}
            solidOpacity={0.95}
            hollowOpacity={0.9}
            wickOpacity={0.8}
          />
        </g>

        {/* Near plane — in focus, carrying the contrast. */}
        <path d={near.average} fill="none" stroke="#0b1220" strokeWidth="2" opacity="0.16" />
        <g opacity="0.62">
          <Candles
            data={near}
            bodyRatio={0.56}
            strokeWidth={2}
            solidOpacity={0.92}
            hollowOpacity={0.85}
            wickOpacity={0.7}
          />
        </g>
      </svg>
    </div>
  );
}
