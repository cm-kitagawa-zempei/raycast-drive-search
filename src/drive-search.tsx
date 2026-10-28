import {
  Action,
  ActionPanel,
  environment,
  getApplications,
  getFrontmostApplication,
  getPreferenceValues,
  Icon,
  List,
  open,
  openCommandPreferences,
} from "@raycast/api";
import { showFailureToast, useLocalStorage } from "@raycast/utils";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { useEffect, useMemo, useState } from "react";
import { bump, frecency, History } from "./frecency";
import { matchTerms, parseQuery, Target } from "./fuzzy";
import { buildIndex, DriveIndex, relAt } from "./index-store";
import { WebUrlResolver } from "./web-url";

const CLOUD_STORAGE = join(homedir(), "Library", "CloudStorage");
const MAX_RESULTS = 100;
// 一致度に足す frecency の重み。log を取り、よく使うものが一致度の差を覆しすぎないようにする
const FRECENCY_WEIGHT = 30;

// 設定でマウント先が指定されていればそれを使い、なければ CloudStorage から prefix で探す
function findDriveRoot(prefix: string): string | undefined {
  const { driveRoot } = getPreferenceValues<{ driveRoot?: string }>();
  if (driveRoot) return existsSync(driveRoot) ? resolve(driveRoot) : undefined;
  try {
    const dir = readdirSync(CLOUD_STORAGE).find((n) => n.startsWith(prefix));
    return dir ? join(CLOUD_STORAGE, dir) : undefined;
  } catch {
    return undefined;
  }
}

// Raycast を呼び出す直前に前面にあったアプリがブラウザならそれで開き、そうでなければデフォルトのブラウザで開く
async function openInBrowser(url: string) {
  const [front, apps] = await Promise.all([getFrontmostApplication().catch(() => undefined), getApplications(url)]);
  const browser = front && apps.find((a) => a.path === front.path);
  await open(url, browser);
}

// File Provider のマウントを直接走査すると遅いので、Spotlight のインデックスから一覧を取る。
// 出力は文字列にせず Buffer のまま受け取る（Buffer はヒープ制限の対象外）
function runMdfind(root: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/mdfind", ["-0", "-onlyin", root, 'kMDItemContentTypeTree == "public.item"']);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`mdfind exited with ${code}`))));
  });
}

// 前回の一覧をファイルから即座に表示し、裏で mdfind を走らせて差し替える
function useDriveIndex(root: string | undefined) {
  const [index, setIndex] = useState<DriveIndex>();
  const [isLoading, setIsLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    const cacheFile = join(environment.supportPath, `${basename(root)}.idx`);

    if (nonce === 0) {
      readFile(cacheFile)
        .then((buf) => !cancelled && setIndex((prev) => prev ?? buildIndex(buf, root)))
        .catch(() => undefined);
    }
    setIsLoading(true);
    runMdfind(root)
      .then(async (buf) => {
        if (cancelled) return;
        setIndex(buildIndex(buf, root));
        await mkdir(environment.supportPath, { recursive: true });
        await writeFile(cacheFile, buf);
      })
      .catch((e) => {
        if (!cancelled) showFailureToast(e, { title: "インデックスの取得に失敗しました" });
      })
      .finally(() => !cancelled && setIsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [root, nonce]);

  return { index, isLoading, reload: () => setNonce((n) => n + 1) };
}

export function DriveSearch({ label, prefix, webUrl }: { label: string; prefix: string; webUrl: WebUrlResolver }) {
  const root = useMemo(() => findDriveRoot(prefix), [prefix]);
  const [searchText, setSearchText] = useState("");
  const { index, isLoading, reload } = useDriveIndex(root);
  // 履歴のキーはドライブ内の相対パス
  const {
    value: history,
    setValue: setHistory,
    isLoading: isHistoryLoading,
  } = useLocalStorage<History>(`history:${prefix}`, {});

  const results = useMemo<string[]>(() => {
    const h = history ?? {};
    const terms = parseQuery(searchText);
    if (terms.length === 0) {
      // クエリが空なら zoxide のように frecency 順で並べる
      return Object.keys(h)
        .filter((rel) => root && existsSync(join(root, rel)))
        .sort((a, b) => frecency(h[b]) - frecency(h[a]))
        .slice(0, MAX_RESULTS);
    }
    if (!index) return [];
    const hasHistory = Object.keys(h).length > 0;
    const target: Target = { text: index.text, pathStart: 0, nameStart: 0, end: 0 };
    const scored: { i: number; score: number }[] = [];
    for (let i = 0; i < index.size; i++) {
      target.pathStart = index.keyStart[i];
      target.nameStart = index.nameStart[i];
      target.end = index.keyEnd[i];
      const s = matchTerms(target, terms);
      if (s === null) continue;
      const boost = hasHistory ? FRECENCY_WEIGHT * Math.log2(1 + frecency(h[relAt(index, i)])) : 0;
      scored.push({ i, score: s + boost - (target.end - target.pathStart) / 100 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map((r) => relAt(index, r.i));
  }, [index, searchText, history, root]);

  if (!root) {
    // Box / Google Drive の片方だけ使う人もいるので、使わないコマンドの無効化へ誘導する
    const { driveRoot } = getPreferenceValues<{ driveRoot?: string }>();
    const where = driveRoot ? `設定で指定したフォルダ ${driveRoot} がありません。` : `${CLOUD_STORAGE} に ${prefix}* がありません。`;
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={`${label} のマウントが見つかりません`}
          description={`${where}\n${label} を使っていない場合は、設定からこのコマンドを無効にできます`}
          actions={
            <ActionPanel>
              <Action title="Open Command Preferences" icon={Icon.Gear} onAction={openCommandPreferences} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const record = (rel: string) => setHistory(bump(history ?? {}, rel));
  // フォルダを開くときも、履歴には選んだファイルを記録する
  const openWeb = async (path: string, rel: string, recordRel = rel) => {
    try {
      await openInBrowser(await webUrl(path, rel));
      record(recordRel);
    } catch (e) {
      await showFailureToast(e, { title: "Web 版を開けませんでした" });
    }
  };
  const reloadAction = (
    <Action
      title="Reload Index"
      icon={Icon.ArrowClockwise}
      shortcut={{ modifiers: ["cmd"], key: "r" }}
      onAction={reload}
    />
  );

  return (
    <List
      isLoading={isLoading || isHistoryLoading}
      filtering={false}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={`${label} を検索（'完全一致 ^前方 後方$ !除外）`}
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={searchText ? "見つかりませんでした" : `${label} を検索`}
        description={`${index?.size ?? 0} 件をインデックス済み`}
        actions={<ActionPanel>{reloadAction}</ActionPanel>}
      />
      <List.Section title={searchText ? "結果" : "よく使うファイル"} subtitle={`${results.length}`}>
        {results.map((rel) => {
          const path = join(root, rel);
          const name = basename(rel);
          const dir = rel.slice(0, Math.max(0, rel.length - name.length - 1));
          return (
            <List.Item
              key={rel}
              icon={{ fileIcon: path }}
              title={name}
              subtitle={dir}
              accessories={history?.[rel] ? [{ icon: Icon.Clock, tooltip: "最近使ったファイル" }] : []}
              actions={
                <ActionPanel>
                  <Action
                    title={`Open in ${label} Web`}
                    icon={Icon.Globe}
                    onAction={() => openWeb(path, rel)}
                  />
                  <Action
                    title={`Open Folder in ${label} Web`}
                    icon={Icon.Folder}
                    onAction={() => openWeb(dirname(path), dir, rel)}
                  />
                  <Action.Open
                    title="Open Local File"
                    target={path}
                    shortcut={{ modifiers: ["opt"], key: "return" }}
                    onOpen={() => record(rel)}
                  />
                  <Action.ShowInFinder
                    path={path}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                    onShow={() => record(rel)}
                  />
                  <Action.CopyToClipboard
                    title="Copy Path"
                    content={path}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                    onCopy={() => record(rel)}
                  />
                  <Action.OpenWith path={path} shortcut={{ modifiers: ["cmd"], key: "o" }} />
                  {reloadAction}
                  {history?.[rel] && (
                    <Action
                      title="Remove from History"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => {
                        const { [rel]: _, ...rest } = history;
                        setHistory(rest);
                      }}
                    />
                  )}
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
