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

## 最低項目

```
source
category
prefecture
municipality
district
date
title
content
url
```

不足項目がある場合は削除しない。`status: incomplete` として Review Queue へ載せる。

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

## 定期運用

GitHub Actions `disaster-social-inbox.yml` が以下を実行する。

1. Inbox Schema 検証
2. Review Queue 生成
3. 検証レポート出力

Apply は実行しない。Review Queue で停止する。
