# 開發流程

三層環境，每一層各自對應 Git 分支、Vercel 網址與 Neon 分支：

| 層 | Git 分支 | 網址 | 資料庫（Neon） |
| --- | --- | --- | --- |
| 功能開發 | `feat/…`、`fix/…` | Vercel 自動產生的 Preview 網址（每次都不同） | `preview` 分支 |
| 測試（staging） | `preview` | 固定網址 https://second-brain-kb-preview.vercel.app | `preview` 分支 |
| 正式 | `main` | https://second-brain-kb.vercel.app | `main` 分支 |

## 步驟

1. 從 `preview` 開功能分支：`git switch preview && git pull && git switch -c feat/xxx`。
2. 開 PR **合併到 `preview`**。Vercel 會先替 PR 產生一個 Preview 部署，確認 READY 後再合併。
3. 合併後 `preview` 會自動部署到固定網址。擁有者在 https://second-brain-kb-preview.vercel.app 用 Google 登入實際測試。測試寫入的資料只進 Neon 的 `preview` 分支，不會碰到正式資料。
4. 測試沒問題，再開 PR **`preview` → `main`**，合併後自動部署到正式站。
5. 只用一般 merge，不要 force-push，也不要直接推 `main`。

## 環境變數

- Vercel 的 Preview 範圍（所有非 `main` 分支，包含 `preview`）用 Neon `preview` 分支的 `DATABASE_URL`；Production 範圍用 Neon `main`。
- Google 登入需要 `NUXT_OAUTH_GOOGLE_CLIENT_ID`、`NUXT_OAUTH_GOOGLE_CLIENT_SECRET`、`OWNER_EMAIL`、`NUXT_APP_SECRET`，Production 與 Preview 都要設。
- Google 只接受登記過的網址，所以只有正式站和固定的 `preview` 網址能登入；功能分支的隨機 Preview 網址無法用 Google 登入，請合併到 `preview` 再測。

Google Cloud OAuth 用戶端需要登記：

| 欄位 | 值 |
| --- | --- |
| 已授權的 JavaScript 來源 | `https://second-brain-kb.vercel.app`、`https://second-brain-kb-preview.vercel.app` |
| 已授權的重新導向 URI | `https://second-brain-kb.vercel.app/auth/google`、`https://second-brain-kb-preview.vercel.app/auth/google` |

## 資料庫 migration

Schema 有改動時，先對 Neon `preview` 分支跑 migration、在測試網址驗證，合併到 `main` 前再對 Neon `main` 跑一次。
