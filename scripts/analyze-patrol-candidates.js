#!/usr/bin/env node
"use strict";

const KEYWORDS = [
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

const TARGETS = [
  { municipality: "八代市", url: "https://www.city.yatsushiro.lg.jp/bousai/default.html", note: "登録済primary" },
  { municipality: "八代市", url: "https://www.city.yatsushiro.lg.jp/kinkyu.html", note: "候補secondary" },
  { municipality: "水俣市", url: "https://www.city.minamata.lg.jp/bousai/kiji003257/index.html", note: "候補primary" },
  { municipality: "宇土市", url: "https://www.city.uto.lg.jp/article/list/1014.html", note: "候補primary" },
  { municipality: "宇土市", url: "https://www.city.uto.lg.jp/article/view/1014/16317.html", note: "登録済WATER" },
  { municipality: "宇土市", url: "https://www.city.uto.lg.jp/article/view/1014/16304.html", note: "候補secondary" },
  { municipality: "宇城市", url: "https://www.city.uki.kumamoto.jp/kinkyu/2606699", note: "登録済primary" },
  { municipality: "美里町", url: "https://www.town.kumamoto-misato.lg.jp/index.html", note: "登録済primary" },
  { municipality: "美里町", url: "https://www.town.kumamoto-misato.lg.jp/kurashi_tetsuzuki/gou-saigai_1/index.html", note: "候補primary" },
  { municipality: "甲佐町", url: "https://www.town.kosa.lg.jp/q/list/51.html", note: "候補primary" },
  { municipality: "芦北町", url: "https://www.town.ashikita.lg.jp/bosai_site/", note: "候補primary" },
  { municipality: "芦北町", url: "https://www.town.ashikita.lg.jp/bosai_site/oshirase_bosai/2111544", note: "候補記事" },
  { municipality: "津奈木町", url: "https://www.town.tsunagi.lg.jp/kinkyu/pub/default.aspx?c_id=9", note: "候補primary" },
  { municipality: "上天草市", url: "https://www.city.kamiamakusa.kumamoto.jp/q/list/542.html", note: "候補primary" },
  { municipality: "天草市", url: "https://www.city.amakusa.kumamoto.jp/bousai/default.html", note: "候補primary" },
  { municipality: "西原村", url: "https://www.vill.nishihara.kumamoto.jp/default.html", note: "候補primary" },
  { municipality: "多良木町", url: "http://www.town.taragi.lg.jp/cgi-bin/smart_alert.php/1/list", note: "候補" },
  { municipality: "多良木町", url: "https://www.town.taragi.lg.jp/gyousei/bousai/index.html", note: "候補" },
  { municipality: "苓北町", url: "https://reihoku-kumamoto.jp/bousai/default.html", note: "候補primary" }
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]) : "";
}

function extractDates(html, text) {
  const patterns = [
    /最終更新日[：:\s]*\[?(\d{4}年\d{1,2}月\d{1,2}日[^\]\s]*)/g,
    /最終更新日[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[^\s<]*)/g,
    /更新日[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[^\s<]*)/g,
    /(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}時\d{1,2}分)/g,
    /(\d{4}年07月\d{1,2}日)/g,
    /(\d{4}-\d{2}-\d{2})/g,
    /更新日時[：:][^\d]*(\d{4}年\d{1,2}月\d{1,2}日[^\s<]*)/g
  ];
  const found = new Set();
  patterns.forEach((re) => {
    let match;
    const r = new RegExp(re.source, re.flags);
    while ((match = r.exec(html)) !== null) {
      found.add(match[1] || match[0]);
    }
  });
  if (text.includes("2026年07月") || text.includes("2026年7月") || text.includes("令和8年") || text.includes("令和８年")) {
    found.add("2026/R8地震関連テキストあり");
  }
  return Array.from(found).slice(0, 8);
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const href = match[1];
    const label = stripHtml(match[2]).slice(0, 120);
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      continue;
    }
    let absolute;
    try {
      absolute = new URL(href, baseUrl).href;
    } catch (_err) {
      continue;
    }
    const hay = label + " " + href + " " + absolute;
    const related = LINK_HINTS.some((hint) => hay.includes(hint));
    if (related) {
      links.push({ url: absolute, label: label || href });
    }
  }
  const seen = new Set();
  return links.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 12);
}

function detectKeywords(text) {
  const hits = {};
  KEYWORDS.forEach((kw) => {
    const count = (text.match(new RegExp(kw, "g")) || []).length;
    if (count > 0) {
      const idx = text.indexOf(kw);
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + 80);
      hits[kw] = {
        count,
        sample: text.slice(start, end).trim()
      };
    }
  });
  return hits;
}

function classifyPageType(text, html, hits, dates, links) {
  const listSignals = /記事一覧|新着情報|新着一覧|緊急情報一覧|過去記事/.test(text);
  const hubSignals = /令和8年熊本地震|災害情報一覧|に関する情報/.test(text);
  const articleSignals = /<article|article\/view|aview\//i.test(html) && !listSignals;
  const staticSignals = /ハザードマップ|防災計画|指定避難所一覧|避難場所を確認/.test(text) && Object.keys(hits).length <= 2;
  if (listSignals || (hubSignals && /一覧/.test(text))) return "記事一覧・災害ハブ";
  if (articleSignals) return "個別記事";
  if (/緊急情報/.test(text) && dates.length > 0) return "緊急情報フィード";
  if (staticSignals && !dates.some((d) => d.includes("2026") || d.includes("R8"))) return "静的防災ページ";
  if (/防災サイト/.test(text) && dates.length > 0) return "防災ポータル";
  return "混合/その他";
}

function scorePage(hits, dates, pageType, text, links) {
  const kwCount = Object.keys(hits).length;
  const hasR8 = /令和8年熊本地震|令和８年熊本地震|2026年07月|2026年7月/.test(text);
  const hasOperational = ["避難所", "給水", "断水", "開設", "通行止め", "罹災"].some((k) => hits[k]);
  const hasRecentDate = dates.some((d) => d.includes("2026") || d.includes("R8") || d.includes("7月"));

  if (pageType === "静的防災ページ" && !hasR8) {
    return { verdict: "△", reason: "防災説明・施設一覧が中心で、今回地震の運用情報更新構造が弱い" };
  }
  if (kwCount === 0) {
    return { verdict: "△", reason: "災害運用キーワードが本文に検出されない" };
  }
  if (pageType === "個別記事" && hasOperational) {
    return { verdict: "○", reason: "単一テーマの運用記事。差分は出るがハブではない" };
  }
  if ((pageType === "記事一覧・災害ハブ" || pageType === "緊急情報フィード" || pageType === "防災ポータル") && hasOperational && (hasR8 || hasRecentDate)) {
    return { verdict: "◎", reason: "災害運用情報が本文または一覧に直接掲載され、更新日時も確認できる" };
  }
  if (hasOperational && hasR8) {
    return { verdict: "◎", reason: "R8地震の運用情報（避難・給水・断水等）が本文に直接ある" };
  }
  if (kwCount >= 2 && links.length >= 3) {
    return { verdict: "○", reason: "本文の直接更新は限定的だが、災害関連内部リンクが多い" };
  }
  if (hasOperational) {
    return { verdict: "○", reason: "運用キーワードはあるが、更新構造が弱いまたは単発記事" };
  }
  return { verdict: "△", reason: "キーワードはあるが災害時の差分更新源として不十分" };
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "KumamotoPatrolAnalyzer/1.0", Accept: "text/html" },
      redirect: "follow"
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeOne(target) {
  try {
    const fetched = await fetchPage(target.url);
    if (!fetched.ok) {
      return {
        ...target,
        error: "HTTP " + fetched.status,
        verdict: "△",
        reason: "ページ取得失敗"
      };
    }
    const text = stripHtml(fetched.html);
    const title = extractTitle(fetched.html);
    const hits = detectKeywords(text);
    const dates = extractDates(fetched.html, text);
    const links = extractLinks(fetched.html, fetched.finalUrl || target.url);
    const pageType = classifyPageType(text, fetched.html, hits, dates, links);
    const scored = scorePage(hits, dates, pageType, text, links);
    return {
      municipality: target.municipality,
      url: target.url,
      note: target.note,
      httpStatus: fetched.status,
      title,
      pageType,
      detectedKeywords: hits,
      updateMarkers: dates,
      relatedLinks: links,
      verdict: scored.verdict,
      reason: scored.reason,
      textLength: text.length
    };
  } catch (err) {
    return {
      ...target,
      error: err.message,
      verdict: "△",
      reason: "取得エラー: " + err.message
    };
  }
}

async function main() {
  const results = [];
  for (const target of TARGETS) {
    process.stderr.write("Analyzing " + target.municipality + " " + target.url + "\n");
    results.push(await analyzeOne(target));
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
