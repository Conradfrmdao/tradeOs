/**
 * Decorative candlestick backdrop for the landing hero.
 *
 * Drawn rather than photographed: it stays sharp at any size, costs a few KB,
 * and carries no licensing question. The series is generated from a fixed seed
 * so the server and the browser render identical markup and it never reflows
 * between loads.
 *
 * Deliberately not a rising chart. A landing page for trading software that
 * shows a line going up implies a return, and this product makes no claim
 * about results — so the series drifts sideways the way a real instrument
 * does. It is texture, not evidence, and is hidden from assistive technology
 * accordingly.
 */

const WIDTH = 1400;
const HEIGHT = 620;
const COUNT = 58;

/**
 * Mulberry32 — a small deterministic generator.
 *
 * `Math.random()` would produce different candles on the server and the
 * client, which React reports as a hydration mismatch.
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
  high: number;
  low: number;
  close: number;
  up: boolean;
}

function buildSeries(): { candles: Candle[]; average: string } {
  const rand = seeded(20260916);
  const slot = WIDTH / COUNT;

  let price = 0.5;
  let drift = 0;
  const candles: Candle[] = [];
  const closes: number[] = [];

  for (let i = 0; i < COUNT; i++) {
    // Momentum that decays, so runs form and break like a real series rather
    // than looking like uniform noise.
    drift = drift * 0.72 + (rand() - 0.5) * 0.055;
    const open = price;
    const close = Math.min(0.92, Math.max(0.08, open + drift));
    const wick = 0.012 + rand() * 0.045;

    candles.push({
      x: i * slot + slot / 2,
      open,
      close,
      high: Math.max(open, close) + wick * rand(),
      low: Math.min(open, close) - wick * rand(),
      up: close >= open,
    });

    closes.push(close);
    price = close;
  }

  // A smoothed line through the closes, for a second layer of depth.
  const window = 6;
  const points = closes.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = closes.slice(from, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    return `${(i * slot + slot / 2).toFixed(1)},${((1 - mean) * HEIGHT).toFixed(1)}`;
  });

  return { candles, average: `M${points.join(' L')}` };
}

const { candles, average } = buildSeries();

export function CandlesBackdrop() {
  const slot = WIDTH / COUNT;
  const body = slot * 0.46;
  const y = (v: number) => (1 - v) * HEIGHT;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-[72%] select-none md:block"
      style={{
        // Fades into the page on the left, where the headline sits, and again
        // at the top and bottom so it never collides with an edge.
        maskImage:
          'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 34%, rgba(0,0,0,0.9) 72%, black 100%), linear-gradient(to bottom, transparent 0%, black 22%, black 74%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 34%, rgba(0,0,0,0.9) 72%, black 100%), linear-gradient(to bottom, transparent 0%, black 22%, black 74%, transparent 100%)',
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
        {/* Price grid, barely there. */}
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1={0}
            x2={WIDTH}
            y1={t * HEIGHT}
            y2={t * HEIGHT}
            stroke="#0f172a"
            strokeWidth="1"
            opacity="0.05"
          />
        ))}

        <path d={average} fill="none" stroke="#0f172a" strokeWidth="1.5" opacity="0.14" />

        {candles.map((c, i) => (
          <g key={i} opacity={0.5}>
            <line
              x1={c.x}
              x2={c.x}
              y1={y(c.high)}
              y2={y(c.low)}
              stroke="#0f172a"
              strokeWidth="1.1"
              opacity="0.45"
            />
            {/* Hollow for up, solid for down — the classic monochrome
                convention, so it reads without colour. */}
            <rect
              x={c.x - body / 2}
              y={y(Math.max(c.open, c.close))}
              width={body}
              height={Math.max(2, Math.abs(y(c.open) - y(c.close)))}
              fill={c.up ? '#ffffff' : '#0f172a'}
              stroke="#0f172a"
              strokeWidth="1.1"
              opacity={c.up ? 0.55 : 0.4}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
