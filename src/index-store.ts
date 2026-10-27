// Raycast の拡張は JS ヒープが 100MB に制限されている。
// Google Drive は日本語の長いパスが 8 万件を超えるため、パスを JS の文字列として持つと上限に達する。
// そこで、ヒープ外に置かれる Buffer / TypedArray だけで一覧を保持する。
//   raw          mdfind の出力（NUL 区切りの絶対パス）。表示時にここから相対パスを切り出す
//   text         正規化した相対パスを連結したもの。照合はこの上で行う
//   *Start/End   各エントリの区間

import { normalize } from "./fuzzy";

export type DriveIndex = {
  size: number;
  raw: Buffer;
  rawStart: Int32Array;
  rawEnd: Int32Array;
  text: Uint16Array;
  keyStart: Int32Array;
  nameStart: Int32Array;
  keyEnd: Int32Array;
};

export function buildIndex(raw: Buffer, root: string): DriveIndex {
  const prefixBytes = Buffer.byteLength(root) + 1;
  let capacity = 1;
  for (let i = raw.indexOf(0); i >= 0; i = raw.indexOf(0, i + 1)) capacity++;

  const rawStart = new Int32Array(capacity);
  const rawEnd = new Int32Array(capacity);
  const keyStart = new Int32Array(capacity);
  const nameStart = new Int32Array(capacity);
  const keyEnd = new Int32Array(capacity);
  // UTF-16 のコード単位数は UTF-8 のバイト数を超えないが、NFKC で伸びる文字もあるので足りなければ広げる
  let text = new Uint16Array(raw.length);
  let pos = 0;
  let size = 0;

  let start = 0;
  while (start < raw.length) {
    let end = raw.indexOf(0, start);
    if (end < 0) end = raw.length;
    if (end - start > prefixBytes) {
      const rel = raw.toString("utf8", start + prefixBytes, end);
      if (!rel.startsWith(".") && !rel.includes("/.")) {
        const key = normalize(rel);
        if (pos + key.length > text.length) {
          const grown = new Uint16Array(Math.max(text.length * 2, pos + key.length));
          grown.set(text.subarray(0, pos));
          text = grown;
        }
        for (let j = 0; j < key.length; j++) text[pos + j] = key.charCodeAt(j);
        rawStart[size] = start + prefixBytes;
        rawEnd[size] = end;
        keyStart[size] = pos;
        nameStart[size] = pos + key.lastIndexOf("/") + 1;
        keyEnd[size] = pos + key.length;
        pos += key.length;
        size++;
      }
    }
    start = end + 1;
  }
  return { size, raw, rawStart, rawEnd, text: text.slice(0, pos), keyStart, nameStart, keyEnd };
}

export function relAt(index: DriveIndex, i: number): string {
  return index.raw.toString("utf8", index.rawStart[i], index.rawEnd[i]);
}
