# 更新反映手順（Update Flow）

## 基本方針

- 自動収集・差分検出・候補生成は行う
- **自動公開は行わない**
- 公開データ（`data/public/`）の変更はレビュー承認後のみ

## フロー

```
公式サイト
  ↓ npm run patrol
monitor/change-log/
data/update_candidates/
  ↓ npm run review
monitor/reports/review_queue.md
monitor/reports/normalized_candidates.json
  ↓ 人手レビュー
reviewStatus: APPROVED / REJECTED
  ↓ data/approved/*.json へ移動・記録
data/approved/
  ↓ npm run apply-approved        （確認のみ）
  ↓ npm run apply-approved --apply （明示承認後のみ反映）
data/public/
```

## 1. 巡回

```bash
npm run patrol
```

- 20ソースを巡回
- 差分は `data/update_candidates/` に保存
- 初期状態は `reviewStatus: REQUIRES_REVIEW`

## 2. レビュー用整理

```bash
npm run review
```

生成物:

- `monitor/reports/review_queue.md` — HIGH / MEDIUM / LOW 別レビュー一覧
- `monitor/reports/normalized_candidates.json` — 正規化済み候補

## 3. 人手レビュー

`review_queue.md` を確認し、各候補を判断する。

| reviewStatus | 意味 |
|--------------|------|
| REQUIRES_REVIEW | 未確認（初期値） |
| APPROVED | 公開反映可 |
| REJECTED | 掲載しない |

## 4. 承認データ作成

承認した候補を `data/approved/YYYYMMDD-<id>.json` に保存する。

必須項目:

- `reviewStatus: "APPROVED"`
- `publicUpdate.target` — `phase1_updates` または `communication_status`
- `publicUpdate.action` — `update`（既存URL更新のみ。新規追加は別途人手設計）
- `publicUpdate.fields` — 反映するフィールド

テンプレート: `data/approved/_template.json`

## 5. 反映前安全確認

`npm run apply-approved`（ドライラン）で以下を確認:

- 公式URLが HTTP 200
- `incident_scope` が `2026_KUMAMOTO_EARTHQUAKE`
- 2016年情報パターンなし
- 自治体ID・URLの一致
- 重複URLなし

## 6. 公開反映

問題なければ、明示的に:

```bash
npm run apply-approved --apply
```

巡回ステータス（`data/public/status.json`）のみ公開する場合:

```bash
npm run publish:patrol -- --publish-status
```

GitHub Actions から手動公開する場合:

- workflow: `Publish Patrol Public Status`
- デフォルト: `status.json` のみ反映
- `apply_approved=true` の場合のみ `data/approved/*.json` を反映

## 7. WATER監視フロー

```
公式WATER情報 (data/water_sources.json)
  ↓ npm run patrol:water
Snapshot (monitor/reports/water-snapshots.json)
  ↓ 差分検知
data/review/water/water_review_queue.json
  ↓ 人手レビュー / 承認
data/approved/*.json
  ↓ Publish Patrol Public Status
公開データ更新
```

- 対象地域: 熊本県・鹿児島県
- 対象分類: MUNICIPALITY / WATERWORKS / DISASTER / SELF_DEFENSE / FIRE / COAST_GUARD
- スケジュール: 毎朝 06:00-10:00 JST（`Water Patrol` workflow）
- `AUTO_PUBLICATION=false`（Review必須）

ローカル確認:

```bash
npm run patrol:water
npm run patrol:water -- --fixture
node scripts/validate-water-patrol.js
```

## 8. 自動運用（CI）

### Patrol workflow

```
公式サイト巡回
  ↓ patrol
差分検知 / update_candidates
  ↓ review
review_queue.md
  ↓ finalize-patrol-run
patrol-summary.json（成功） / patrol-error-report.json（失敗）
monitor/evidence/*.json（変更検知時）
```

- 初回実行: `monitor/baselines/patrol-snapshots.seed.json` から snapshot を復元
- 2回目以降: Actions cache から前回 snapshot を復元して比較
- `AUTO_PUBLICATION=false` を維持（候補の自動公開なし）

### Publish workflow

```
review_queue
  ↓ 人手レビュー
data/approved/*.json
  ↓ Publish Patrol Public Status（apply_approved=true）
data/public/*
  ↓ git commit / push
本番反映
```

ローカル確認:

```bash
npm run patrol:dry-run
npm run publish:patrol
npm run publish:patrol -- --publish-status
```

反映後は必ず:

```bash
npm test
npm run build
```

## 禁止事項

- HTML差分のみでの即時公開
- 2016年熊本地震情報の新規採用
- 一般防災ページの災害情報扱い
- AIによる推測補完
- 未確認情報の掲載
