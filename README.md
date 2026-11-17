# ゴルフ研鑽会 成績表

年間成績（ベスト7・ベスト8・平均・順位・色分け）を自動で集計し、会員がスマホで見られるWebアプリ。

- 会員：ログイン不要で「順位表」「成績一覧」「選手ページ」を見る
- 管理者（1〜2名）：ログインして「スコア入力」「管理（選手・開催回・色分け・CSV）」を使う

| 部分 | 使っているもの |
| --- | --- |
| 画面 | HTML / CSS / JavaScript だけの1ページ（ビルド不要） |
| 公開 | GitHub Pages（`main` に push すると自動公開） |
| データ | Supabase（PostgreSQL）。読み取りは誰でも、書き込みは管理者だけ（RLS で制限） |

## 初回の準備（1回だけ・30分程度）

### 1. Supabase
1. https://supabase.com でプロジェクトを作る（Region は **Northeast Asia (Tokyo)**）。
2. 左メニュー **SQL Editor** を開き、[`supabase/schema.sql`](supabase/schema.sql) の全文を貼り付けて **Run**。
3. **Authentication → Sign In / Providers**：「Allow new users to sign up」を **オフ** にする（知らない人が登録できないように）。
4. **Authentication → Users → Add user → Create new user**：管理者のメールアドレスとパスワードで作成（「Auto Confirm User」にチェック）。
5. 作ったユーザーの **UID** をコピーし、SQL Editor で次を実行して管理者に登録する：
   ```sql
   insert into public.admins (user_id, note) values ('ここにUID', '管理者の名前');
   ```
6. **Project Settings → API**（または Data API）で **Project URL** と **anon / publishable key** を控える。
   ※ `service_role` / secret key は使わない。どこにも貼らないこと。

### 2. GitHub
1. リポジトリの **Settings → Secrets and variables → Actions → Variables** に次の2つを登録：
   - `SUPABASE_URL`：Project URL
   - `SUPABASE_ANON_KEY`：anon / publishable key
2. **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
3. **Actions** タブで `deploy` を実行（または `main` に push）。完了すると公開URLが表示される。

### 3. 初期データの取り込み
1. 公開URLの下にある「管理者ログイン」からログイン。
2. **管理 → CSV** で `players.csv`・`events.csv`・`scores.csv` をまとめて選び、「取り込む」。

## 普段の使い方
- ラウンドの後：**スコア入力** → 開催回を選ぶ → 「前回の参加者」をタップで追加 → スコアを入れて保存。
- 中止になった回：**管理 → 開催回** で「中止」にチェック。
- 色の境目（79・82）：**管理 → 色分け**。
- バックアップ：**管理 → CSV** で3つのファイルを月1回程度書き出して保管する（Excel でそのまま開ける）。

## 集計ルール
- ベスト7／ベスト8：スコアの少ない順に7つ／8つの合計。足りなければ「—」
- 平均⑧＝ベスト8÷8（小数3桁）、全平均＝全計÷回数（小数2桁）
- 順位（区分ごと）：ベスト8の少ない順 → 回数の多い順 → 全計の少ない順。3つとも同じなら同順位。8ラウンド未満は「順位外」（回数の多い順）
- 中止の回は開催回数に含めない。回番号が空欄の回も集計に含める
- ベスト8に使うスコアが同点で複数あるときは、早い回を使ったものとして強調表示する

計算は [`js/stats.js`](js/stats.js) にまとめてある。

## 開発
```bash
python3 -m http.server 8765      # http://localhost:8765/ で確認（config.js が空ならデモモード）
npm test                          # 集計ロジックのテスト
GOLF_DATA_DIR=<CSVのフォルダ> npm test             # 実データで検証値も確認
GOLF_DATA_DIR=<CSVのフォルダ> node tests/e2e.cjs   # 画面の通しテスト（Playwright）
```
会員の実名を含む CSV はリポジトリに入れない（`.gitignore` で除外済み）。

## 未確定（今は作り込んでいない）
- 種別「CT」の意味と特別な集計の有無（今は列見出しに表示するだけ）
- J区分の意味（今は一般・女子と同じ扱いで別の順位表）
- 赤字の71、オレンジ文字の120 の意味（今は色分けの対象外）
