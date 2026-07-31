# Review 承認フロー

## フロー概要

```
change-log（差分検知）
  ↓
classification（キーワード分類 / confidence=HIGH のみ）
  ↓
review queue（PENDING / review_required=true）
  ↓
Decision Layer（APPROVED / REJECTED / PENDING）
  ↓
Public Update Queue
  ↓
Validation Gate
  ↓
Apply（--confirm 必須）
```

## Review Queue

マスターファイル: `data/review_queue/patrol_review_queue.json`

### 必須条件

| 項目 | 値 |
|------|-----|
| status | `PENDING`（未確認時） |
| review_required | `true` |
| auto_publish | `false` |
| decision.status | `PENDING` / `APPROVED` / `REJECTED` |
| source_trace | `classification_id` 必須 |

### カテゴリ

- WATER / SHELTER / COMMUNICATION / VOLUNTEER / ROAD / SUPPORT

## Decision Layer

Decision ログ: `data/review_queue/patrol_review_decision_log.json`

### 承認手順

1. Review Queue の該当 item を確認
2. `source_trace` で change-log → classification を追跡
3. 公式ソース URL で内容を人手確認
4. Decision を記録:
   - **APPROVED** — Public Update 候補へ
   - **REJECTED** — 公開しない
   - **PENDING** — 保留

### 禁止事項

- 推測分類による承認
- キーワード不一致 item の承認
- 自動承認・自動公開

## 差分判定ルール

| 差分種別 | 処理 |
|---------|------|
| 差分なし | パイプライン終了 |
| `PAGE_UPDATED_AT_CHANGED` のみ | **無視**（分類対象外） |
| 本文 hash 変更 | Classification → Review Queue |

## Public Update 以降

```bash
npm run convert:approved-updates   # APPROVED のみ変換
npm run gate:public-updates         # URL・schema 検証
npm run apply:public-updates -- --confirm  # 手動 Confirm のみ
```

## Audit Trace

各 item は以下のチェーンで追跡可能:

```
source_id → change_log → classification_id → queue_id
  → decision → update_id → apply_id
```

ダッシュボード: `monitor/dashboard/operation-dashboard.json` の `audit_traces`
