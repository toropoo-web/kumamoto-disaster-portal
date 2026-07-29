#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "site");
const PUBLICATION = path.join(ROOT, "publication");
const ZIP_NAME = "kumamoto-disaster-portal-v1.0.0.zip";
const ZIP_PATH = path.join(ROOT, ZIP_NAME);

const COPY_FILES = [
  "index.html",
  "favicon.svg",
  "css/styles.css",
  "js/app.js",
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json"
];

const PUBLICATION_README = `# 令和8年熊本地震 自治体公式情報まとめ

**Version:** v1.0.0

## サイト概要

令和8年熊本地震（2026年7月28日発生）に関し、自治体および公的機関が公表した一次情報へのリンクを整理して掲載する静的Webサイトです。

## 対象自治体

- 熊本県
- 熊本市
- 宇土市
- 宇城市
- 美里町

## 掲載カテゴリ

本バージョンで掲載しているカテゴリ（4種）:

| カテゴリID | カテゴリ名 | 掲載カード数 |
|------------|-----------|-------------|
| EMERGENCY | 地震・緊急情報 | 4 |
| SHELTER | 避難所 | 1 |
| WATER | 断水・給水 | 2 |
| SUPPORT | 被災者支援 | 1 |

## 掲載情報の基準

- 各リンク先は自治体・公的機関の個別公式ページです
- 確認済み（VERIFIED）の情報のみ掲載しています
- 対象災害: 令和8年熊本地震（2026_KUMAMOTO_EARTHQUAKE）

## 配置方法

1. 本パッケージを展開します
2. ファイル一式をWebサーバーのドキュメントルートに配置します
3. \`index.html\` がルートでアクセス可能であることを確認します

例（任意の静的サーバー）:

\`\`\`bash
npx serve . -l 3000
\`\`\`

Apache・Nginx・GitHub Pages・Cloudflare Pages・Netlify・Vercel（Static）など、静的ファイル配信に対応した環境で利用できます。

## 注意事項

- 掲載情報は確認時点の内容です。避難・給水・道路規制などの最新状況は、必ずリンク先の公式発表をご確認ください
- 緊急時は、自治体・警察・消防などの指示を優先してください
- 本サイトは公式発表の二次整理であり、公式発表の代替ではありません
`;

function rmDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(relPath) {
  const src = path.join(SITE, relPath);
  const dest = path.join(PUBLICATION, relPath);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function build() {
  rmDir(PUBLICATION);
  ensureDir(PUBLICATION);

  COPY_FILES.forEach(copyFile);
  fs.writeFileSync(path.join(PUBLICATION, "README.md"), PUBLICATION_README, "utf8");

  if (fs.existsSync(ZIP_PATH)) {
    fs.unlinkSync(ZIP_PATH);
  }

  const isWin = process.platform === "win32";
  if (isWin) {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${PUBLICATION}\\*' -DestinationPath '${ZIP_PATH}' -Force"`,
      { stdio: "inherit", cwd: ROOT }
    );
  } else {
    execSync(`zip -r "${ZIP_PATH}" .`, { cwd: PUBLICATION, stdio: "inherit" });
  }

  const stats = fs.statSync(ZIP_PATH);
  const audit = {
    publicationFiles: fs.readdirSync(PUBLICATION, { recursive: true }).map(String),
    zipSizeBytes: stats.size,
    zipSizeKB: Math.round(stats.size / 1024),
    excluded: ["screenshots", "savepoints", "operations", "scripts"],
    copyFiles: COPY_FILES.concat(["README.md"])
  };

  console.log(JSON.stringify(audit, null, 2));
}

build();
