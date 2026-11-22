interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

export function Sparkline({
  values,
  width = 112,
  height = 28,
}: SparklineProps) {
  if (values.length < 2) {
    return (
      <span className="text-xs text-stone-400" aria-label="Not enough data">
        —
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padY = 3;
  const usableH = height - padY * 2;

  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padY + usableH - ((v - min) / span) * usableH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible text-orange-600"
      aria-label={`Score trend from ${values[0]} to ${values[values.length - 1]}`}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords.join(" ")}
      />
    </svg>
  );
}
