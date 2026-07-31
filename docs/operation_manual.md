# 熊本地震 災害ポータル 運用マニュアル

## 概要

本ポータルは令和8年熊本地震に関する自治体公式情報を集約・公開する Phase1 災害ポータルです。  
対象自治体: **KM000〜KM022（23自治体）**

## パイプライン構成

```
Patrol → Classification → Review Queue → Decision
  → Public Update Queue → Validation Gate → Apply → Public Data → UI
```

運用ダッシュボード: `monitor/dashboard/operation-dashboard.json`

## 日常運用

### 1. 定期 Patrol

```bash
npm run patrol:pipeline
```

- Patrol → change-log → classification → review queue まで自動実行
- **Apply は実行しない**（手動 Confirm 必須）

### 2. 監視レポート

```bash
npm run monitor:operation
npm run dashboard:operation
```

出力:
- `data/operation_monitor/latest-report.json`
- `monitor/dashboard/operation-dashboard.json`

### 3. 状態レイヤー

| 色 | 意味 |
|----|------|
| GREEN | 正常 |
| YELLOW | Review 待ちあり |
| RED | 取得失敗 / Gate FAIL / データ異常 |

## 公開データ更新（手動のみ）

Public Data の直接編集は禁止。必ず Apply パイプラインを使用する。

```bash
# 1. 承認済みを変換
npm run convert:approved-updates

# 2. Validation Gate
npm run gate:public-updates

# 3. Apply（Confirm 必須）
npm run apply:public-updates -- --confirm
```

## 検証コマンド

| コマンド | 用途 |
|---------|------|
| `npm test` | データ・UI・パイプライン検証 |
| `npm run build` | 公開インデックス再生成 |
| `npm run validate:production-readiness` | 本番 readiness |
| `npm run validate:public-operation-ready` | **公開運用最終ゲート** |

## 制約（厳守）

- 自治体の自動追加なし
- `monitor/sources.json` の自動変更なし
- 自動公開なし（`auto_publish=false`）
- 自動承認なし
- `data/public/` への直接編集なし

## ロールバック

Apply 実行時は rollback メタデータが `data/public_update_apply/diff/` に保存される。  
Patrol production rollback: `data/patrol_production/rollback/`

## 関連ドキュメント

- [review_flow.md](./review_flow.md) — Review 承認フロー
- [incident_response.md](./incident_response.md) — 障害対応
