# PHASE28 Workflow Audit — Force Update Pipeline

## 目的

PC が停止していても、GitHub Actions のみで以下が自動実行されること。

```text
X Feed 取得 (kumamoto-disaster-x-feed)
  → data/posts.json 等を commit / push
  → repository_dispatch (x-feed-updated)
Portal 同期 (kumamoto-disaster-portal)
  → sync:x-feed → validate → build
  → data/public/x_feed_preview.json を commit / push
Render
  → main への push で autoDeploy
```

## リポジトリ別ワークフロー

### kumamoto-disaster-x-feed

| Workflow | ファイル | トリガー |
|----------|----------|----------|
| Fetch X Posts | `.github/workflows/fetch-x-posts.yml` | `schedule: */30 * * * *` (UTC), `workflow_dispatch` |
| CI | `.github/workflows/ci.yml` | `push`, `pull_request`, `workflow_dispatch` |

**Fetch X Posts ジョブ構成**

1. `fetch` — 取得・ビルド・検証・データ commit/push
2. `dispatch-portal` — `PORTAL_DISPATCH_TOKEN` で Portal の `repository_dispatch` を送信（402 ブロック時はスキップ）

**必須 Secrets**

- `X_API_BEARER_TOKEN`
- `PORTAL_DISPATCH_TOKEN`（Portal リポジトリへの dispatch 用 PAT）

### kumamoto-disaster-portal

| Workflow | ファイル | トリガー |
|----------|----------|----------|
| X Feed Sync and Portal Publish | `.github/workflows/x-feed-sync.yml` | `repository_dispatch` (x-feed-updated), `schedule: 15,45 * * * *` (UTC バックアップ), `workflow_dispatch` |
| CI | `.github/workflows/ci.yml` | `push`, `pull_request`（スケジュールなし） |

**公開反映**

- `render.yaml` の `autoDeploy: true` により main への push で Render が再ビルド・公開

## PC 依存だった箇所（修正済み）

| 問題 | 対策 |
|------|------|
| X Feed が手動実行のみと文書化されていた | `*/30` cron を必須化、ドキュメント更新 |
| Portal 同期が dispatch 失敗時に止まる | UTC :15/:45 のバックアップ cron |
| Portal 同期後に build 未実行 | `npm run build` を workflow に追加 |
| Render 連携の明示なし | `render.yaml` の `autoDeploy: true` 検証ステップを追加 |
| dispatch が commit 有無に依存 | `dispatch-portal` を独立ジョブ化（402 以外は dispatch 試行） |

## 検証コマンド

```bash
# Portal リポジトリ
npm run validate:force-update-pipeline
node scripts/validate-x-feed-sync-workflow.js

# X Feed リポジトリ（兄弟ディレクトリ）
cd ../kumamoto-disaster-x-feed && npm test
```

出力: `data/operation/phase28-pipeline-audit.json`

## 運用上の注意

- `PORTAL_DISPATCH_TOKEN` 未設定時は dispatch ジョブが失敗するが、Portal 側の :15/:45 cron で最大 30 分遅延のバックアップ同期が動く
- X API HTTP 402 時はデータ更新・dispatch ともスキップ（既存データ維持）
- Patrol / 公開データ Apply は本パイプラインとは別（人手レビュー必須のまま）
