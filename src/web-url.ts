import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// ローカルのファイルから Web 版の URL を求める。path は絶対パス、rel はドライブ内の相対パス
export type WebUrlResolver = (path: string, rel: string) => Promise<string>;

// Google ドライブ パソコン版はファイルとフォルダの拡張属性にアイテム ID を持っている。
// open?id= の URL はファイル・フォルダ・ドキュメント/スプレッドシートのどれでも正しい画面に飛ぶ
export const googleDriveWebUrl: WebUrlResolver = async (path, rel) => {
  try {
    const { stdout } = await run("/usr/bin/xattr", ["-p", "com.google.drivefs.item-id#S", path]);
    return `https://drive.google.com/open?id=${encodeURIComponent(stdout.trim())}`;
  } catch {
    const page = googleDriveTopPage(rel);
    if (page) return `https://drive.google.com/drive/${page}`;
    throw new Error("Google ドライブのアイテム ID が見つかりません");
  }
};

const GOOGLE_DRIVE_TOP: Record<string, string> = {
  マイドライブ: "my-drive",
  "My Drive": "my-drive",
  共有ドライブ: "shared-drives",
  "Shared drives": "shared-drives",
};

// マウント直下や「マイドライブ」「共有ドライブ」は ID を持たないので、対応する一覧画面を開く
function googleDriveTopPage(rel: string): string | undefined {
  if (rel === "") return "my-drive";
  const names = rel.normalize("NFC").split("/");
  const page = GOOGLE_DRIVE_TOP[names[0]];
  // 共有ドライブそのもの（共有ドライブ/<名前>）も ID が取れなければ一覧で代用する
  if (names.length === 1 || (names.length === 2 && page === "shared-drives")) return page;
  return undefined;
}

const BOX_SYNC_DB = join(homedir(), "Library", "Application Support", "Box", "Box", "data", "sync.db");

type BoxItem = { box_id: string; item_type: number; parent_item_id: string | null; name: string };

// Box Drive は拡張属性に ID を持たないので、Box Drive のローカル DB を親フォルダからたどって ID を引く。
// DB は Box Drive が開いたままロックしており、最新の変更は WAL にあるため、WAL ごとコピーして読む
export const boxWebUrl: WebUrlResolver = async (path, rel) => {
  // Box のルートフォルダの ID は 0
  if (rel === "") return "https://app.box.com/folder/0";
  const names = rel.split("/").map((n) => n.normalize("NFC"));
  // DB 側の正規化形式が分からないので NFC と NFD の両方で探す。name 列は COLLATE NOCASE
  const candidates = new Set(names.flatMap((n) => [n, n.normalize("NFD")]));
  const inList = [...candidates].map((n) => `'${n.replaceAll("'", "''")}'`).join(",");
  const rows = await queryBoxDb(`SELECT box_id, item_type, parent_item_id, name FROM box_item WHERE name IN (${inList})`);
  const isDir = (await stat(path)).isDirectory();
  const same = (a: string, b: string) => a.normalize("NFC").toLowerCase() === b.toLowerCase();

  let parent = "0";
  for (let i = 0; i < names.length; i++) {
    const type = i === names.length - 1 && !isDir ? 0 : 1;
    const item = rows.find((r) => r.parent_item_id === parent && r.item_type === type && same(r.name, names[i]));
    if (!item) throw new Error("Box Drive のデータベースにこのファイルが見つかりません");
    parent = item.box_id;
  }
  return `https://app.box.com/${isDir ? "folder" : "file"}/${parent}`;
};

async function queryBoxDb(sql: string): Promise<BoxItem[]> {
  const dir = await mkdtemp(join(tmpdir(), "drive-search-"));
  try {
    const db = join(dir, "sync.db");
    await copyFile(BOX_SYNC_DB, db).catch(() => {
      throw new Error("Box Drive のデータベースが見つかりません");
    });
    await copyFile(`${BOX_SYNC_DB}-wal`, `${db}-wal`).catch(() => undefined);
    const { stdout } = await run("/usr/bin/sqlite3", ["-json", db, sql], { maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
