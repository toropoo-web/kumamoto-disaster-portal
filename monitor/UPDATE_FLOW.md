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
