# 知庫

個人用的 Markdown 知識庫。筆記用 `[[wikilink]]` 串起來，AI 先查主張、再提議知識圖譜的變更。圖譜不會在你確認前改寫，每一次套用都是新版本，還原也會再產生一個版本，所以還原本身可以再還原。

介面是繁體中文。圖譜節點同時存中文名、英文名與別名，預設顯示中文。

這是 v1：只有擁有者能登入。學生留言與建議的資料表已留好，畫面還沒做。Obsidian 匯入與 AI Gateway 也不在這一版。

## 本機怎麼跑

需要 Node.js 22+、pnpm 10、以及 **PostgreSQL 18 與 pgvector**。

有 Docker 時：

```bash
docker compose up -d
```

連線是 `postgresql://postgres:postgres@127.0.0.1:54329/kb`。把這個字串同時填進 `.env` 的 `DATABASE_URL` 與 `DATABASE_URL_UNPOOLED`。

沒有 Docker 時，用本機 PostgreSQL 18（需已安裝 `postgresql-18-pgvector`），建立角色與資料庫後把連線字串寫進 `.env`。開發用的 `.env` 不要提交。

```bash
cp .env.example .env
# 至少填 DATABASE_URL、DATABASE_URL_UNPOOLED、OWNER_EMAIL、NUXT_APP_SECRET
pnpm install
pnpm dev
```

`pnpm dev` 會用直接連線跑 migration、在知識庫還是空的時候寫入四篇力學示範筆記，然後把網站開在 [http://127.0.0.1:38471](http://127.0.0.1:38471)。

登入頁的「開發模式登入」只在非正式環境、且 `DEV_AUTH_BYPASS=true` 時出現。`NODE_ENV=production` 或 `VERCEL_ENV=production` 時這個入口會關閉。

沒有 `GEMINI_API_KEY`，或 `LLM_PROVIDER=mock` 時，查核與圖譜抽取走固定規則，整條流程可以在本機跑完。畫面上會標示目前是示範模型；沒有 Exa / Tavily 金鑰時，網路引用會標成「示範來源」。

常用指令：

```bash
pnpm test          # 圖譜引擎與資料庫整合測試
pnpm db:migrate    # 套用 packages/db/migrations
pnpm db:seed       # 空庫時寫入示範筆記
pnpm worker        # 本機可選的佇列 worker（正式環境由 Vercel 處理）
pnpm db:generate   # 改過 Drizzle schema 後產生新的 SQL migration
```

## 環境變數

`.env.example` 只有名稱。意義如下。

| 名稱 | 用途 |
| --- | --- |
| `DATABASE_URL` | 網站用的連線。Vercel 請填 Neon **pooled** URL。本機可與直接連線相同。主機名稱含 `neon.tech` 時，網站改用 `@neondatabase/serverless`。設 `DATABASE_DRIVER=postgres` 可強制用 postgres.js。 |
| `DATABASE_URL_UNPOOLED` | Neon **直接連線**。migration 與本機 `pnpm worker` 用這個。本機沒有 pooler 時，填跟 `DATABASE_URL` 一樣即可。 |
| `GEMINI_API_KEY` | 有這把金鑰且 `LLM_PROVIDER` 不是 `mock`，就呼叫 Google Gemini。 |
| `LLM_PROVIDER` | `mock` 或 `gemini`。留空且沒有金鑰時視為 mock。 |
| `EXTRACTION_MODEL` | 抽主張、抽圖譜。預設 `gemini-3.5-flash-lite`。 |
| `VERDICT_MODEL` | 判定與對齊既有節點。預設 `gemini-3.8-flash`。 |
| `EMBEDDING_MODEL` | 預設 `gemini-embedding-001`，維度 768，對應 `doc_chunks.embedding vector(768)`。 |
| `EXA_API_KEY` / `TAVILY_API_KEY` | 查核的網頁證據。先用 Exa，額度用到約九成改 Tavily。兩把都沒有就用示範摘錄。 |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | Google 登入。 |
| `OWNER_EMAIL` | 唯一能登入的擁有者信箱。其他 Google 帳號會被拒絕。 |
| `NUXT_APP_SECRET` | 簽章 session。可用 `openssl rand -base64 32`。 |
| `NUXT_SESSION_PASSWORD` | 舊名稱。若沒設 `NUXT_APP_SECRET`，啟動時會抄過來。正式環境請只設 `NUXT_APP_SECRET`。 |
| `MONTHLY_BUDGET_USD` | 新工作區的每月 AI 上限，預設 10。之後可在設定頁改。 |
| `DEV_AUTH_BYPASS` | `true` 才顯示開發登入。正式環境無效。 |
| `PROCESS_JOBS_INLINE` | `true` 時網站在同一個 Vercel 請求裡處理佇列。正式環境設 `true`（不再用 Render worker）。 |
| `RESEND_API_KEY` / `NOTIFY_EMAIL_FROM` | 預算警告的信。沒設就只在站內通知。 |
| `AI_MIN_INTERVAL_MS` | 打 Gemini 前的間隔，避免太密。 |
| `DATABASE_DRIVER` | `neon` 或 `postgres`，用來覆蓋自動判斷。 |

## Neon

已有一個 Neon 專案，這個程式還沒拿到連線字串，開發與測試都打本機 Postgres（PostgreSQL 18 + pgvector）。

| 項目 | 值 |
| --- | --- |
| 名稱 | `second-brain-kb` |
| Project ID | `withered-cell-74523049` |
| 區域 | `aws-ap-southeast-1` |
| 版本 | Postgres 18 |
| 預設資料庫 | `neondb` |
| 擴充 | `vector`（pgvector）已啟用 |

Migration 在 `packages/db/migrations/`，是 Drizzle 產生的 SQL，開頭有 `CREATE EXTENSION IF NOT EXISTS vector;`。套到 Neon 時用**直接連線**，不要用 pooler：

```bash
DATABASE_URL_UNPOOLED='postgresql://…@ep-….aws-ap-southeast-1.aws.neon.tech/neondb?sslmode=require' pnpm db:migrate
```

`pnpm db:migrate` 讀 `DATABASE_URL_UNPOOLED`，沒有才退回 `DATABASE_URL`。

網站（Vercel）的 `DATABASE_URL` 請填 **pooled** URL（主機名稱通常含 `-pooler` 與 `neon.tech`）。程式看到 `neon.tech` 會用 `@neondatabase/serverless`。Worker 與 migration 繼續用 `DATABASE_URL_UNPOOLED` 的直接連線。

## Vercel

只部署 Nuxt 網站。查核與圖譜任務在 Vercel 上以 `PROCESS_JOBS_INLINE=true` 執行：同一個請求會處理佇列，並受 Hobby 方案最長 300 秒限制；`processPending` 會在時限前停下來，避免函式被強制中止。另外每天由 Cron 呼叫 `/api/cron/process-jobs` 清掉剩餘工作（Hobby 一天只能跑一次）。

在 Vercel 用 Git 匯入這個倉庫後，專案設定用下面這組。`apps/web/vercel.json` 已寫入 install / build，Root Directory 仍要在 Dashboard 設成 `apps/web`，否則 Vercel 會在倉庫根目錄找 `nuxt.config.ts`。

| 設定 | 值 |
| --- | --- |
| Root Directory | `apps/web` |
| Include source files outside of the Root Directory | 開啟。pnpm workspace 的 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`packages/` 都在倉庫根目錄。 |
| Framework Preset | Nuxt.js |
| Node.js | 22.x（`apps/web/.node-version`） |
| Install Command | `cd ../.. && pnpm install --frozen-lockfile` |
| Build Command | `pnpm build`（在 `apps/web` 裡就是 `nuxt build`） |
| Output Directory | 留空。不要填 `.output`、`dist` 或 `public`。 |

`nuxt build` 在 Vercel 上會自動用 Nitro 的 vercel preset，把 Build Output API 寫到 Root Directory 底下的 `.vercel/output`。Vercel 認這個目錄；另外指定 Output Directory 會讓 serverless 函式部署失敗。

環境變數只填名稱對應的值，不要把 `.env` 提交上去。

網站要能啟動並登入：

- `DATABASE_URL`：Neon **pooled** URL（主機名稱含 `neon.tech` 時會用 `@neondatabase/serverless`）
- `NUXT_APP_SECRET`
- `OWNER_EMAIL`
- `NUXT_OAUTH_GOOGLE_CLIENT_ID`
- `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`

要改呼叫 Gemini，並在 Vercel 上處理佇列：

- `GEMINI_API_KEY`
- `LLM_PROVIDER`＝`gemini`
- `PROCESS_JOBS_INLINE`＝`true`

可選：`EXA_API_KEY`、`TAVILY_API_KEY`、`EXTRACTION_MODEL`、`VERDICT_MODEL`、`EMBEDDING_MODEL`、`MONTHLY_BUDGET_USD`、`RESEND_API_KEY`、`NOTIFY_EMAIL_FROM`。

不要在 Vercel 設定 `DEV_AUTH_BYPASS`。`DATABASE_URL_UNPOOLED` 給 migration 與本機 worker，網站不必設。正式與預覽環境請另設 `CRON_SECRET`，供每日排程驗證。Production 的 `DATABASE_URL` 請指向 Neon `main` 的 pooled 連線，Preview 請指向 Neon `preview` 分支的 pooled 連線。

Google 同意畫面的重新導向網址加上 `https://<你的網域>/auth/google`。本機是 `http://127.0.0.1:38471/auth/google`。

## 佇列與可選的本機 worker

正式環境不再使用 Render。網站在 Vercel 以 `PROCESS_JOBS_INLINE=true` 處理佇列，並用每日 Cron（`0 16 * * *`，UTC 16:00，也就是台北時間隔日 00:00）補跑 `/api/cron/process-jobs`。Cron 請求必須帶 `Authorization: Bearer $CRON_SECRET`。

`render.yaml` 仍留在倉庫裡，但目前不會部署。本機若想自己跑佇列，用 `pnpm worker`。

## Google 登入

1. 在 Google Cloud Console 建立 OAuth 用戶端（網頁應用程式）。
2. 已授權的重新導向 URI：`http://127.0.0.1:38471/auth/google` 與正式網域的 `/auth/google`。
3. 把 client id / secret 寫進環境變數，`OWNER_EMAIL` 設成你的 Google 信箱。
4. 其他帳號登入會被拒絕。

## 測試

```bash
pnpm test
```

整合測試使用 `DATABASE_URL` 指向的資料庫；若主機是本機，會改連同一個執行個體上的 `kb_test`，並在開頭清空資料。請不要把 `DATABASE_URL` 指到 Neon 再跑測試。

## 這一版沒做的

- 學生身分的介面、留言、修改建議（資料表 `comments`、`suggestions` 已在 migration 裡）
- Obsidian 倉庫匯入
- 透過 Vercel AI Gateway 呼叫模型（現在是 `@ai-sdk/google`，之後只要改 provider）
- Vercel 專案已接上 Git：`main` 部署到 Production，其他分支部署到 Preview。Neon 同樣用 `main` 給 Production、`preview` 給 Preview。請自行填入 Google OAuth、Gemini 與 Exa 等密鑰。
