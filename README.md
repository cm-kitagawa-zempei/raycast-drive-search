# Drive Search

Box Drive / Google Drive のファイルを Raycast から曖昧検索する拡張機能です。

- **速い** — ドライブを直接走査せず、macOS の Spotlight インデックスから一覧を取得します。前回の一覧はキャッシュされるので、開いた瞬間から検索できます
- **fzf ライクな検索** — スペース区切りの AND 検索、完全一致・前方一致・後方一致・除外に対応。ファイル名での一致を優先します
- **よく使うファイルが上に来る** — zoxide と同じ frecency（頻度 × 最近さ）で並べ替えます。何も入力しなければ最近よく開いたファイルの一覧になります
- **日本語に強い** — 全角/半角、濁点の合成・分解（NFC/NFD）、大文字/小文字の違いを吸収して照合します
- **大量のファイルでも動く** — 数万〜十万件規模のドライブでも Raycast のメモリ制限に収まるように実装しています

## 動作要件

- macOS
- [Raycast](https://www.raycast.com/)
- [Node.js](https://nodejs.org/) 22.22.2 以上（インストール時のビルドに使います）
- 以下のいずれか（または両方）
  - [Box Drive](https://www.box.com/drive) — `~/Library/CloudStorage/Box-Box` にマウントされていること
  - [Google ドライブ パソコン版](https://www.google.com/drive/download/) — `~/Library/CloudStorage/GoogleDrive-<アカウント>` にマウントされていること

## インストール

```sh
git clone https://github.com/cm-kitagawa-zempei/raycast-drive-search.git
cd raycast-drive-search
npm install
npm run dev
```

`npm run dev` を実行すると Raycast に **Search Box** と **Search Google Drive** の 2 つのコマンドが登録されます。登録されたら `Ctrl + C` で止めて構いません（コマンドは Raycast に残ります）。

> pnpm を使っている場合は `pnpm install && pnpm run dev` でも同じです。

Raycast の設定 (Extensions) から、各コマンドにホットキーやエイリアスを割り当てておくと便利です。

### アップデート

```sh
cd raycast-drive-search
git pull
npm install
npm run dev
```

## 使い方

コマンドを開いて検索語を入力します。

| 入力    | 意味                               |
| ------- | ---------------------------------- |
| `foo`   | 曖昧一致（`f` `o` `o` が順に含まれる） |
| `'foo`  | 部分一致（`foo` をそのまま含む）     |
| `^foo`  | ファイル名が `foo` で始まる          |
| `foo$`  | ファイル名が `foo` で終わる（例: `.pdf$`） |
| `!foo`  | `foo` を含むものを除外               |

スペースで区切った語はすべてを満たすもの（AND）に絞り込まれます。例: `見積 2026 .xlsx$ !old`

### アクション

| キー        | 動作                     |
| ----------- | ------------------------ |
| `↵`         | 開く                     |
| `⌘ ↵`       | Finder で表示            |
| `⌘ ⇧ C`     | パスをコピー             |
| `⌘ O`       | アプリを選んで開く       |
| `⌘ R`       | インデックスを再読み込み |

開いた・Finder で表示した・パスをコピーしたファイルは履歴に記録され、次回以降の順位が上がります。不要な履歴はアクションパネルの **Remove from History** で消せます。

## 設定

Google ドライブに複数のアカウントでログインしているなど、マウント先が複数ある場合は自動検出で意図しない方が選ばれることがあります。その場合は Raycast の設定 (Extensions → Drive Search → 各コマンド) の **Box Folder** / **Google Drive Folder** に検索したいフォルダを指定してください。

> ファイル選択ダイアログで `~/Library` が見えないときは `⌘ ⇧ G` を押して `~/Library/CloudStorage` を入力します。

## うまく動かないとき

**「マウントが見つかりません」と表示される**

Box Drive / Google ドライブ パソコン版が起動していて、`~/Library/CloudStorage` 配下にフォルダがあるか確認してください。古いバージョンの Google ドライブ（`/Volumes/GoogleDrive` にマウントされるもの）には対応していません。

**検索結果が 0 件、または一部のファイルしか出てこない**

Spotlight のインデックスを使っているため、Spotlight がドライブを索引していないと見つかりません。ターミナルで次のコマンドを実行して、ファイルが表示されるか確認してください。

```sh
mdfind -onlyin ~/Library/CloudStorage/Box-Box 'kMDItemContentTypeTree == "public.item"' | head
```

何も表示されない場合は、システム設定 → Spotlight →「検索のプライバシー」にドライブのフォルダが入っていないか確認してください。追加したばかりのファイルは、Spotlight に索引されてから `⌘ R` で再読み込みすると出てくるようになります。

## プライバシー

ファイルの一覧と利用履歴はすべてお使いの Mac の中だけで扱います。外部への送信は一切行いません。

- ファイル一覧のキャッシュ: Raycast の拡張機能用データフォルダ
- 利用履歴: Raycast の LocalStorage

## ライセンス

[MIT](./LICENSE)
