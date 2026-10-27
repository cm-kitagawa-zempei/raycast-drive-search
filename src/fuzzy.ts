// fzf の extended search 記法のサブセット
//   foo    曖昧一致
//   'foo   部分一致（完全一致）
//   ^foo   前方一致（ファイル名）
//   foo$   後方一致（ファイル名）
//   !foo   除外（部分一致）
// スペース区切りの各語は AND で評価する。
//
// 照合対象は Uint16Array 上の区間で受け取る（index.ts 参照）。

export type Term = { kind: "fuzzy" | "exact" | "prefix" | "suffix" | "negate"; codes: number[] };

// text[pathStart, end) がドライブ内の相対パス、text[nameStart, end) がファイル名
export type Target = { text: Uint16Array; pathStart: number; nameStart: number; end: number };

const BOUNDARY = new Set([..."/_- .()[]【】「」"].map((c) => c.charCodeAt(0)));
const NAME_BONUS = 24;

// 全角英数→半角、半角カナ→全角、濁点の合成（NFD→NFC）をまとめて行う
export function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

function toCodes(s: string): number[] {
  return Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
}

export function parseQuery(query: string): Term[] {
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((t): Term => {
      if (t.startsWith("!") && t.length > 1) return { kind: "negate", codes: toCodes(t.slice(1)) };
      if (t.startsWith("'") && t.length > 1) return { kind: "exact", codes: toCodes(t.slice(1)) };
      if (t.startsWith("^") && t.length > 1) return { kind: "prefix", codes: toCodes(t.slice(1)) };
      if (t.endsWith("$") && t.length > 1) return { kind: "suffix", codes: toCodes(t.slice(0, -1)) };
      return { kind: "fuzzy", codes: toCodes(t) };
    });
}

function isBoundary(t: Uint16Array, s: number, i: number): boolean {
  return i === s || BOUNDARY.has(t[i - 1]);
}

// fzf v1 と同じく、前方走査で末尾を決め、後方走査で最短の区間に縮めてから採点する
function fuzzyScore(t: Uint16Array, s: number, e: number, p: number[]): number | null {
  let pi = 0;
  let end = -1;
  for (let i = s; i < e && pi < p.length; i++) {
    if (t[i] === p[pi]) {
      pi++;
      end = i;
    }
  }
  if (pi < p.length) return null;

  let start = end;
  pi = p.length - 1;
  for (let i = end; i >= s; i--) {
    if (t[i] === p[pi]) {
      if (--pi < 0) {
        start = i;
        break;
      }
    }
  }

  let score = 0;
  let prev = -1;
  let consecutive = 0;
  pi = 0;
  for (let i = start; i <= end && pi < p.length; i++) {
    if (t[i] !== p[pi]) continue;
    score += 16;
    if (isBoundary(t, s, i)) score += 8;
    if (prev === i - 1) {
      consecutive++;
      score += 4 * consecutive;
    } else {
      consecutive = 0;
      if (prev >= 0) score -= 3 + (i - prev - 1);
    }
    prev = i;
    pi++;
  }
  return score;
}

function matchesAt(t: Uint16Array, i: number, p: number[]): boolean {
  for (let j = 0; j < p.length; j++) if (t[i + j] !== p[j]) return false;
  return true;
}

function indexOf(t: Uint16Array, s: number, e: number, p: number[]): number {
  for (let i = s; i + p.length <= e; i++) if (matchesAt(t, i, p)) return i;
  return -1;
}

function exactScore(t: Uint16Array, s: number, e: number, p: number[]): number | null {
  const i = indexOf(t, s, e, p);
  if (i < 0) return null;
  return p.length * 20 + (isBoundary(t, s, i) ? 8 : 0);
}

// 一致しなければ null。ファイル名で一致した語には加点する
export function matchTerms({ text: t, pathStart, nameStart, end }: Target, terms: Term[]): number | null {
  let total = 0;
  for (const { kind, codes: p } of terms) {
    let s: number | null;
    switch (kind) {
      case "negate":
        if (indexOf(t, pathStart, end, p) >= 0) return null;
        continue;
      case "prefix":
        s = nameStart + p.length <= end && matchesAt(t, nameStart, p) ? p.length * 20 + NAME_BONUS : null;
        break;
      case "suffix":
        s = end - p.length >= nameStart && matchesAt(t, end - p.length, p) ? p.length * 20 + NAME_BONUS : null;
        break;
      case "exact": {
        const n = exactScore(t, nameStart, end, p);
        s = n !== null ? n + NAME_BONUS : exactScore(t, pathStart, end, p);
        break;
      }
      case "fuzzy": {
        const n = fuzzyScore(t, nameStart, end, p);
        s = n !== null ? n + NAME_BONUS : fuzzyScore(t, pathStart, end, p);
        break;
      }
    }
    if (s === null) return null;
    total += s;
  }
  return total;
}
