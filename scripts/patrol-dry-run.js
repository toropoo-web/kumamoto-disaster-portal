#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "monitor", "reports");
const CHANGE_LOG_DIR = path.join(ROOT, "monitor", "change-log");
const SNAPSHOT_FILE = path.join(REPORTS_DIR, "dry-run-snapshots.json");

const { fetchSource } = require("../monitor/crawler");
const { parsePage, extractTitle, hashContent, normalizeContent } = require("../monitor/parser");

const DRY_RUN_KEYWORDS = [
  "避難",
  "避難所",
  "開設",
  "給水",
  "断水",
  "水道",
  "復旧",
  "ボランティア",
  "支援",
  "災害",
  "通行止め",
  "罹災"
];

const LINK_HINTS = [
  "避難",
  "給水",
  "断水",
  "災害",
  "緊急",
  "防災",
  "罹災",
  "通行",
  "支援",
  "ボランティア",
  "kinkyu",
  "bousai",
  "saigai",
  "hinan"
];

/** Latest review Primary / Secondary (sources.json 未反映) */
const TARGETS = [
  { municipality: "八代市", role: "primary", url: "https://www.city.yatsushiro.lg.jp/bousai/default.html" },
  { municipality: "八代市", role: "secondary", url: "https://www.city.yatsushiro.lg.jp/kinkyu.html" },
  { municipality: "水俣市", role: "primary", url: "https://www.city.minamata.lg.jp/bousai/kiji003257/index.html" },
  { municipality: "宇土市", role: "primary", url: "https://www.city.uto.lg.jp/article/list/1014.html" },
  { municipality: "宇土市", role: "secondary", url: "https://www.city.uto.lg.jp/article/view/1014/16317.html" },
  { municipality: "宇土市", role: "secondary", url: "https://www.city.uto.lg.jp/article/view/1014/16304.html" },
  { municipality: "宇城市", role: "primary", url: "https://www.city.uki.kumamoto.jp/kinkyu/2606699" },
  { municipality: "美里町", role: "primary", url: "https://www.town.kumamoto-misato.lg.jp/kurashi_tetsuzuki/gou-saigai_1/index.html" },
  { municipality: "甲佐町", role: "primary", url: "https://www.town.kosa.lg.jp/q/list/51.html" },
  { municipality: "芦北町", role: "primary", url: "https://www.town.ashikita.lg.jp/bosai_site/hinan" },
  { municipality: "芦北町", role: "secondary", url: "https://www.town.ashikita.lg.jp/bosai_site/" },
  { municipality: "芦北町", role: "secondary", url: "https://www.town.ashikita.lg.jp/bosai_site/oshirase_bosai/2111544" },
  { municipality: "津奈木町", role: "primary", url: "https://www.town.tsunagi.lg.jp/kinkyu/pub/default.aspx?c_id=9" },
  { municipality: "上天草市", role: "primary", url: "https://www.city.kamiamakusa.kumamoto.jp/q/list/542.html" },
  { municipality: "天草市", role: "primary", url: "https://www.city.amakusa.kumamoto.jp/bousai/default.html" },
  { municipality: "西原村", role: "primary", url: "https://www.vill.nishihara.kumamoto.jp/bousai/default.html" },
  { municipality: "多良木町", role: "primary", url: "http://www.town.taragi.lg.jp/cgi-bin/smart_alert.php/1/list" },
  { municipality: "苓北町", role: "primary", url: "https://reihoku-kumamoto.jp/bousai/default.html" }
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sourceKey(target) {
  return target.municipality + "|" + target.role + "|" + target.url;
}

function readSnapshots() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return { version: 1, generatedAt: null, sources: {} };
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

function writeSnapshots(data) {
  ensureDir(path.dirname(SNAPSHOT_FILE));
  data.generatedAt = new Date().toISOString();
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function findDryRunKeywords(text) {
  const found = [];
  DRY_RUN_KEYWORDS.forEach(function (keyword) {
    if (text.includes(keyword)) {
      found.push(keyword);
    }
  });
  return found;
}

function extractUpdateMarkers(html, text) {
  const markers = new Set();
  const patterns = [
    /最終更新日[：:\s]*\[?(\d{4}年\d{1,2}月\d{1,2}日[^\]\s<]*)/g,
    /最終更新日[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[^\s<]*)/g,
    /更新日[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[^\s<]*)/g,
    /(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}時\d{1,2}分)/g,
    /\[(\d{4}年\d{1,2}月\d{1,2}日)\]/g
  ];
  patterns.forEach(function (pattern) {
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(html)) !== null) {
      markers.add((match[1] || match[0]).trim());
    }
  });
  if (/令和8年熊本地震|令和８年熊本地震/.test(text)) {
    markers.add("令和8年熊本地震関連");
  }
  if (/2026年0?7月/.test(text)) {
    markers.add("2026年7月更新テキスト");
  }
  return Array.from(markers).slice(0, 10);
}

function extractArticleHeadlines(html) {
  const headlines = [];
  const patterns = [
    /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi,
    /<a[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/gi
  ];
  patterns.forEach(function (pattern) {
    let match;
    while ((match = pattern.exec(html)) !== null && headlines.length < 8) {
      const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length >= 8 && text.length <= 120) {
        if (/避難|給水|断水|地震|災害|罹災|通行|開設|熊本/.test(text)) {
          headlines.push(text);
        }
      }
    }
  });
  const seen = new Set();
  return headlines.filter(function (item) {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  }).slice(0, 6);
}

function extractRelatedLinks(html, baseUrl) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      continue;
    }
    let absolute;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch (_err) {
      continue;
    }
    const hay = label + " " + href + " " + absolute;
    if (LINK_HINTS.some(function (hint) { return hay.includes(hint); })) {
      links.push({ url: absolute, label: label || href });
    }
  }
  const seen = new Set();
  return links.filter(function (item) {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 8);
}

function detectEncodingIssue(text, title) {
  return (
    /[\uFFFD]/.test(text + title) ||
    (title && title.length > 4 && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(title))
  );
}

function judgePatrolFitness(target, httpResult, htmlResult, parsed, text) {
  const operational = ["避難", "避難所", "開設", "給水", "断水", "罹災", "通行止め", "災害"];
  const opHits = htmlResult.keywords.filter(function (k) { return operational.indexOf(k) >= 0; });
  const hasRecent = htmlResult.updateMarkers.some(function (m) {
    return /2026|令和8|令和８|7月/.test(m);
  });

  if (!httpResult.pass) {
    return { verdict: "FAIL", reason: "HTTP取得失敗（status/timeout/network）" };
  }
  if (!htmlResult.pass) {
    return { verdict: "FAIL", reason: "HTML解析不能（title/本文不足）" };
  }
  if (htmlResult.encodingIssue && opHits.length === 0) {
    return {
      verdict: "WARNING",
      reason: "文字化けの可能性あり。キーワード検出がparser経由で空になるが、記事一覧構造は取得可能"
    };
  }
  if (target.municipality === "多良木町") {
    const hasR8 = /令和8年熊本地震|令和８年熊本地震/.test(text);
    const july2026 = /2026年0?7月/.test(text);
    if (!hasR8 && !july2026) {
      return { verdict: "FAIL", reason: "防災無線一覧にR8地震向け更新なし（最新2026/6以前）。差分監視対象として不適" };
    }
  }
  if (target.role === "primary") {
    if (opHits.length >= 2 && (hasRecent || htmlResult.articleHeadlines.length >= 1)) {
      return { verdict: "PASS", reason: "運用キーワードと更新情報を検出。継続監視可能" };
    }
    if (opHits.length >= 1 && hasRecent) {
      return { verdict: "PASS", reason: "運用キーワードと2026/R8更新を検出" };
    }
    if (htmlResult.encodingIssue && htmlResult.articleHeadlines.length >= 2) {
      return { verdict: "WARNING", reason: "文字コード要確認だが記事一覧・更新構造は検出" };
    }
    return { verdict: "WARNING", reason: "取得は成功したがPrimaryとしての運用キーワード/更新が弱い" };
  }
  if (opHits.length >= 1 || htmlResult.articleHeadlines.length >= 1) {
    return { verdict: "PASS", reason: "Secondaryとして差分検出可能" };
  }
  return { verdict: "WARNING", reason: "Secondaryだが運用キーワードが少ない。補助監視のみ" };
}

async function analyzeTarget(target) {
  const fetched = await fetchSource(target.url);
  const parsed = parsePage(fetched);
  const html = fetched.body || "";
  const normalized = normalizeContent(html);
  const text = normalized.text;
  const title = parsed.title || extractTitle(html);
  const dryKeywords = findDryRunKeywords(text);
  const parserKeywords = parsed.keywords || [];
  const keywords = Array.from(new Set(dryKeywords.concat(parserKeywords)));
  const updateMarkers = extractUpdateMarkers(html, text);
  const articleHeadlines = extractArticleHeadlines(html);
  const relatedLinks = extractRelatedLinks(html, fetched.finalUrl || target.url);
  const encodingIssue = detectEncodingIssue(text, title);

  const httpResult = {
    pass: fetched.ok && fetched.status >= 200 && fetched.status < 400,
    status: fetched.status,
    timeout: fetched.error === "timeout",
    error: fetched.error,
    message: fetched.message || "",
    redirectCount: fetched.redirectCount || 0,
    finalUrl: fetched.finalUrl || target.url
  };

  const htmlResult = {
    pass: Boolean(title) && text.length >= 80,
    title: title,
    textLength: text.length,
    keywords: keywords,
    updateMarkers: updateMarkers,
    articleHeadlines: articleHeadlines,
    relatedLinks: relatedLinks,
    encodingIssue: encodingIssue,
    contentHash: parsed.contentHash || hashContent(normalized.normalized),
    contaminationRisk: parsed.contaminationRisk
  };

  const fitness = judgePatrolFitness(target, httpResult, htmlResult, parsed, text);

  return {
    municipality: target.municipality,
    role: target.role,
    url: target.url,
    http: httpResult.pass ? "PASS" : "FAIL",
    httpDetail: httpResult,
    htmlParse: htmlResult.pass ? "PASS" : "FAIL",
    htmlDetail: htmlResult,
    detectedKeywords: keywords,
    updateInfo: updateMarkers,
    articleHeadlines: articleHeadlines,
    relatedLinks: relatedLinks,
    verdict: fitness.verdict,
    reason: fitness.reason,
    checkedAt: new Date().toISOString()
  };
}

function snapshotHash(snapshot) {
  if (!snapshot) return null;
  if (snapshot.htmlDetail && snapshot.htmlDetail.contentHash) {
    return snapshot.htmlDetail.contentHash;
  }
  return snapshot.contentHash || null;
}

function snapshotTitle(snapshot) {
  if (!snapshot) return "";
  if (snapshot.htmlDetail && snapshot.htmlDetail.title) {
    return snapshot.htmlDetail.title;
  }
  return snapshot.title || "";
}

function snapshotKeywords(snapshot) {
  if (!snapshot) return [];
  if (snapshot.detectedKeywords) return snapshot.detectedKeywords;
  return snapshot.keywords || [];
}

function buildDiffEntry(key, previous, current) {
  const currentHash = current.htmlDetail.contentHash;
  const previousHash = snapshotHash(previous);
  if (!previousHash) {
    return {
      key: key,
      changeType: "INITIAL_SNAPSHOT",
      previousHash: null,
      currentHash: currentHash,
      detectedAt: new Date().toISOString()
    };
  }
  if (previousHash !== currentHash) {
    return {
      key: key,
      changeType: "CONTENT_CHANGED",
      previousHash: previousHash,
      currentHash: currentHash,
      titleFrom: snapshotTitle(previous),
      titleTo: current.htmlDetail.title,
      keywordsFrom: snapshotKeywords(previous),
      keywordsTo: current.detectedKeywords,
      detectedAt: new Date().toISOString()
    };
  }
  return null;
}

async function main() {
  ensureDir(REPORTS_DIR);
  ensureDir(CHANGE_LOG_DIR);

  const snapshots = readSnapshots();
  const results = [];
  const diffEntries = [];

  for (const target of TARGETS) {
    const result = await analyzeTarget(target);
    results.push(result);

    const key = sourceKey(target);
    const previous = snapshots.sources[key] || null;
    const diff = buildDiffEntry(key, previous, result);
    if (diff) {
      diffEntries.push(diff);
    }
    snapshots.sources[key] = {
      municipality: target.municipality,
      role: target.role,
      url: target.url,
      savedAt: result.checkedAt,
      contentHash: result.htmlDetail.contentHash,
      title: result.htmlDetail.title,
      keywords: result.detectedKeywords
    };
  }

  writeSnapshots(snapshots);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "patrol-dry-run-" + stamp + ".json");
  const changeLogPath = path.join(CHANGE_LOG_DIR, "dry-run-" + stamp + ".json");

  const summary = {
    generatedAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    targetCount: TARGETS.length,
    passCount: results.filter(function (r) { return r.verdict === "PASS"; }).length,
    warningCount: results.filter(function (r) { return r.verdict === "WARNING"; }).length,
    failCount: results.filter(function (r) { return r.verdict === "FAIL"; }).length,
    httpFailCount: results.filter(function (r) { return r.http === "FAIL"; }).length,
    htmlFailCount: results.filter(function (r) { return r.htmlParse === "FAIL"; }).length,
    diffCount: diffEntries.length,
    snapshotFile: path.relative(ROOT, SNAPSHOT_FILE),
    changeLogPath: path.relative(ROOT, changeLogPath),
    results: results
  };

  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    changeLogPath,
    JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        incidentScope: summary.incidentScope,
        diffCount: diffEntries.length,
        entries: diffEntries
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log("");
  console.log("DRY_RUN_REPORT=" + reportPath);
  console.log("DRY_RUN_CHANGE_LOG=" + changeLogPath);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
