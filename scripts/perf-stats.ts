export type DurationStats = {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
};

export function durationStats(samples: number[]): DurationStats {
  if (samples.length === 0) {
    throw new Error("durationStats requires at least one sample");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p95Index = Math.min(n - 1, Math.max(0, Math.ceil(n * 0.95) - 1));
  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median,
    p95: sorted[p95Index],
  };
}

export function classifyHttp(ms: number): "FAST" | "NORMAL" | "SLOW" | "VERY_SLOW" | "CRITICAL" {
  if (ms < 200) return "FAST";
  if (ms < 500) return "NORMAL";
  if (ms < 1000) return "SLOW";
  if (ms < 2000) return "VERY_SLOW";
  return "CRITICAL";
}
