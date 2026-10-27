// zoxide と同じ考え方の frecency
// 開くたびに rank を +1 し、最終利用からの経過時間で重みを掛ける。
// rank の合計が上限を超えたら全体を減衰させ、小さくなったものは捨てる。

export type History = Record<string, { rank: number; last: number }>;

const MAX_TOTAL_RANK = 1000;
const HOUR = 60 * 60 * 1000;

export function frecency(entry: { rank: number; last: number } | undefined, now = Date.now()): number {
  if (!entry) return 0;
  const age = now - entry.last;
  if (age < HOUR) return entry.rank * 4;
  if (age < 24 * HOUR) return entry.rank * 2;
  if (age < 7 * 24 * HOUR) return entry.rank * 0.5;
  return entry.rank * 0.25;
}

export function bump(history: History, path: string, now = Date.now()): History {
  const next: History = { ...history, [path]: { rank: (history[path]?.rank ?? 0) + 1, last: now } };
  const total = Object.values(next).reduce((sum, e) => sum + e.rank, 0);
  if (total <= MAX_TOTAL_RANK) return next;

  const aged: History = {};
  for (const [p, e] of Object.entries(next)) {
    const rank = e.rank * 0.9;
    if (rank >= 1) aged[p] = { rank, last: e.last };
  }
  return aged;
}
