# 障害対応手順

## 検知対象

Operation Monitor / Dashboard が以下を検出:

| 種別 | 重大度 | 対応 |
|------|--------|------|
| URL 取得失敗 | HIGH | ソース URL・ネットワーク確認 |
| Public hash 変化 | HIGH | 直接編集の有無確認 |
| Gate FAIL | HIGH | Gate レポート確認・修正 |
| HTML 構造変更 | LOW | パーサー影響確認 |
| charset 異常 | MEDIUM | エンコーディング確認 |
| source 消失 | MEDIUM | snapshot baseline 再登録 |
| UI data 不整合 | HIGH | `npm test` 実行 |

## 状態レイヤー別対応

### RED（即時対応）

1. `npm run monitor:operation` で incident 一覧確認
2. `monitor/dashboard/operation-dashboard.json` の `incident_count` 確認
3. 原因別に対処（下記）

### YELLOW（Review 待ち）

1. `review_pending_count` を確認
2. [review_flow.md](./review_flow.md) に従い人手レビュー実施
3. 緊急度の高いカテゴリ（WATER / SHELTER）を優先

### GREEN（正常）

定期 Patrol・監視を継続。

## 対処手順

### URL 取得失敗

```bash
# 該当ソースの到達性確認
npm run validate:real-patrol-operation

# snapshot 再登録（必要時）
npm run finalize:snapshot-baseline
```

### Public Data 異常

```bash
npm run validate:production-readiness
npm run validate:public-operation-ready
```

直接編集を検出した場合:
1. Apply パイプライン経由でない変更をロールバック
2. `data/production_readiness/public-data-hash.json` を正しい状態で再記録

### Apply ロールバック

Apply diff: `data/public_update_apply/diff/`  
rollback 関数: `rollbackPublicUpdateApply`（`monitor/public-update-apply-engine.js`）

```bash
# Apply 履歴確認
cat data/public_update_apply/apply_history.json
```

### Gate FAIL

```bash
npm run gate:public-updates
# data/public_update_gate/patrol_public_update_gate.json を確認
```

## エスカレーション

| 状況 | アクション |
|------|-----------|
| 複数ソース同時 unreachable | ネットワーク・自治体サイト障害を疑う |
| hash 不一致 + 未承認 Apply なし | 直接編集の可能性、即調査 |
| classification 急増 | 災害情報更新の可能性、Review 優先 |

## 定期確認

```bash
npm run patrol:pipeline
npm run monitor:operation
npm run dashboard:operation
npm run validate:public-operation-ready
```

レポート: `data/operation/final-readiness-report.json`
