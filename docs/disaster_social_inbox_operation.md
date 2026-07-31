# 現地支援情報（Community Layer）運用仕様

## 対象情報

- SNS投稿
- 民間支援
- 現地情報

公式情報Layerとは分離して管理する。

## 投入先

```
data/community/disaster_social_inbox.json
```

## 処理フロー

```
Inbox
 ↓
Review Queue
 ↓
人手確認
 ↓
Apply
 ↓
Index
 ↓
公開
```

## 投入形式

| 形式 | 説明 |
|------|------|
| JSON | `items` 配列へ直接追加 |
| CSV | `source,category,prefecture,municipality,district,date,title,content,url` 形式 |
| 手動 | `import_format: "MANUAL"` で inbox に登録 |
| SNS抽出 | `import_format: "SNS"` で抽出結果を投入（`source_type` 指定推奨） |
| WEB取得 | `import_format: "JSON"` または CSV で取得結果を投入 |

投入時に必ず保持する項目:

```
source
source_type
captured_at
url
keywords
```

## 最低項目

```
source_type
captured_at
source
category
prefecture
municipality
district
date
title
content
url
keywords
```

### source_type

```
X
Instagram
WEB
MANUAL
OTHER
```

未指定時は import_format から推定（MANUAL→MANUAL、JSON/CSV→WEB）。

### keywords

任意。検索補助用の文字列配列。

```
keywords: ["給水", "生活用水"]
```

## 地域受付

災害情報の横断収集（九州災害 Community Layer）。

* 今回の運用データ対象: 熊本県、鹿児島県霧島市
* AI判断・推測による地域拡張は行わない（鹿児島県全域・他市町村の追加禁止）

マスタ:

```
data/community/community_region_master.json  （extensible: true）
data/community/municipality_master.json    （熊本県市町村の検索補助）
```

システム側で対象地域を固定・絞り込まない。隣接県や被災可能性による地域選定は行わない。

地域フィルターは検索軸であり、対象地域の制限ではない。

地域項目（必須フィールド）:

```json
{
  "prefecture": "熊本県",
  "municipality": "",
  "district": ""
}
```

検索補助（任意）:

```json
{
  "prefecture_group": "KYUSHU_SOUTH",
  "region_group": "阿蘇地域"
}
```

`prefecture_group` / `region_group` は検索補助のみ。除外・選別には使わない。

不足項目がある場合は削除しない。`status: incomplete` として Review Queue へ載せる。

地域不明・URL未確認などは推測補完しない。`review_note` に確認事項のみ記録する。

```
review_note: "municipality, district 未確認"
```

## 情報源管理

```
data/community/disaster_social_sources.json
```

各 source に `source_type` を設定する。

```
X / Instagram / WEB / MANUAL / OTHER
```

## 運用監視

```bash
npm run monitor:disaster-social-operation
```

出力:

```
data/operation_monitor/disaster-social-operation.json
```

監視項目:

- Index件数
- Review Queue件数
- incomplete件数
- duplicate件数
- last_updated

## 運用コマンド

```bash
# Inbox → Review Queue 生成（Apply対象候補の生成まで）
npm run review:disaster-social-queue

# Review Queue で APPROVED になった項目のみ Index へ反映
npm run apply:disaster-social-queue

# パイプライン検証
npm run validate:disaster-social-pipeline

# 公開用 JSON 再生成
npm run build:disaster-social-index
```

## 禁止事項

- AIによる情報価値判断・選別
- 信頼度による自動除外
- 自動削除
- 自動 Apply（必ず人手確認後に Apply）

## 検索条件（公開後）

地域・日付・カテゴリのみ。UIセクション「現地支援情報を探す」から検索する。

検索階層:

```
熊本県
 ↓
市町村
 ↓
地区
```

例: 熊本県 + 阿蘇市 + 2026-08-01 + WATER

## 定期運用

GitHub Actions `disaster-social-inbox.yml` が以下を実行する。

1. Inbox Schema 検証
2. Pipeline 検証
3. Review Queue 生成
4. 運用監視レポート出力

Apply は実行しない。Review Queue で停止する。
