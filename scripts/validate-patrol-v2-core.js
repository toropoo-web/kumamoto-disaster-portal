#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, "monitor", "patrol-v2", "fixtures");

const { extractContentRegions } = require("../monitor/patrol-v2/content-region-extractor");
const { detectMultiLayerChange } = require("../monitor/patrol-v2/multi-layer-detector");
const {
  filterMunicipalityPatrolSources,
  isXRelatedSource
} = require("../monitor/patrol-v2/source-guard");
const {
  discoverFeedUrls,
  parseFeedEntries,
  buildFeedFingerprint
} = require("../monitor/patrol-v2/feed-fetcher");
const { compareSource } = require("../monitor/diff-engine");
const { parsePage } = require("../monitor/parser");
const { shouldRetryWithBrowser } = require("../monitor/patrol-v2/fetch-orchestrator");

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function main() {
  const errors = [];
  const checks = [];

  function check(label, pass) {
    checks.push({ check: label, pass: pass });
    if (!pass) {
      errors.push(label);
    }
  }

  const v1Html = readFixture("municipality-page-v1.html");
  const v2Html = readFixture("municipality-page-v2.html");
  const v1NavOnlyHtml = readFixture("municipality-page-v1-nav-only.html");
  const rssXml = readFixture("sample-rss.xml");

  const regionV1 = extractContentRegions(v1Html);
  const regionV2 = extractContentRegions(v2Html);
  const regionV1NavOnly = extractContentRegions(v1NavOnlyHtml);

  check("region extractor produces hash on v1", regionV1.regionHash.length === 64);
  check(
    "region hash stable when only nav/footer changes",
    regionV1.regionHash === regionV1NavOnly.regionHash
  );
  check(
    "region hash changes when main content changes",
    regionV1.regionHash !== regionV2.regionHash
  );
  check("region text captures main content change", /体育館前/.test(regionV2.regionText));

  const feedUrls = discoverFeedUrls("https://example.test/bousai/", v1Html);
  check("feed discovery finds alternate link candidates", feedUrls.length >= 1);

  const feedEntries = parseFeedEntries(rssXml);
  check("rss parser extracts entries", feedEntries.length === 2);
  const fp1 = buildFeedFingerprint(feedEntries);
  const fp2 = buildFeedFingerprint(feedEntries.slice(0, 1));
  check("feed fingerprint changes when entries change", fp1 !== fp2);

  const previous = {
    reachable: true,
    contentHash: "aaa",
    regionHash: regionV1.regionHash,
    title: "テスト自治体 防災情報",
    pageUpdatedAt: "2026-07-30",
    feedFingerprint: fp1
  };
  const currentParsed = parsePage(
    {
      ok: true,
      url: "https://example.test/",
      finalUrl: "https://example.test/",
      status: 200,
      body: v2Html,
      headers: {},
      fetchMode: "http"
    },
    { feedFingerprint: fp2 }
  );
  const multiLayer = detectMultiLayerChange(previous, currentParsed);
  check("multi-layer detector flags change", multiLayer.changed === true);
  check("multi-layer score > 0", multiLayer.score > 0);

  const source = {
    id: "TEST-municipality",
    name: "テスト自治体",
    url: "https://example.test/",
    category: "MUNICIPALITY"
  };
  const diffEntries = compareSource(source, currentParsed, previous);
  check("diff-engine compareSource detects changes", Array.isArray(diffEntries) && diffEntries.length > 0);
  if (diffEntries && diffEntries.length) {
    check("diff entry has detection signals", Array.isArray(diffEntries[0].detectionSignals));
  }

  check("X source blocked by guard", isXRelatedSource({ id: "KM001-x-feed", url: "https://x.com/foo" }));
  const filtered = filterMunicipalityPatrolSources([
    { id: "KM001-home", url: "https://example.test/" },
    { id: "KM001-twitter", url: "https://twitter.com/foo" }
  ]);
  check("filter removes X-related sources", filtered.length === 1 && filtered[0].id === "KM001-home");

  const thinHtml = { ok: true, body: "<html><body>loading</body></html>", status: 200 };
  check("browser retry on thin loading page", shouldRetryWithBrowser(thinHtml, "auto") === true);
  check("browser skip when http mode", shouldRetryWithBrowser(thinHtml, "http") === false);

  const modulePaths = [
    "monitor/patrol-v2/fetch-orchestrator.js",
    "monitor/patrol-v2/browser-fetcher.js",
    "monitor/patrol-v2/alert-dispatcher.js"
  ];
  modulePaths.forEach(function (relPath) {
    check(relPath + " exists", fs.existsSync(path.join(ROOT, relPath)));
  });

  const runMonitorSource = fs.readFileSync(path.join(ROOT, "scripts", "run-monitor.js"), "utf8");
  const runPatrolCronSource = fs.readFileSync(path.join(ROOT, "scripts", "run-patrol-cron.js"), "utf8");
  check(
    "run-monitor.js has no X/Twitter API imports",
    !/sync-x-feed|twitter|x\.com/i.test(runMonitorSource)
  );
  check(
    "run-patrol-cron.js has no X sync step",
    !/sync-x-feed|sync:x-feed|twitter/i.test(runPatrolCronSource)
  );
  check(
    "run-monitor uses source-guard filter",
    /filterMunicipalityPatrolSources/.test(runMonitorSource)
  );

  const sourcesJson = JSON.parse(fs.readFileSync(path.join(ROOT, "monitor", "sources.json"), "utf8"));
  const { getMunicipalityPatrolSources } = require("../monitor/municipality-patrol-sources");
  const merged = filterMunicipalityPatrolSources(
    getMunicipalityPatrolSources().concat(sourcesJson.communication || [])
  );
  const xLeaks = merged.filter(function (source) {
    return isXRelatedSource(source);
  });
  check("loaded patrol sources contain no X-related entries", xLeaks.length === 0);

  const hikawaSources = (sourcesJson.municipalities || []).filter(function (item) {
    return String(item.area_id) === "KM007" || /hikawa/i.test(item.id || "");
  });
  const hikawaUrlsOk = hikawaSources.every(function (item) {
    return String(item.url || "").indexOf("www.town.hikawa.kumamoto.jp") >= 0;
  });
  check("氷川町 sources use www.town.hikawa.kumamoto.jp", hikawaUrlsOk);

  const snapshotsPath = path.join(ROOT, "monitor", "reports", "snapshots.json");
  if (fs.existsSync(snapshotsPath)) {
    const snapshots = JSON.parse(fs.readFileSync(snapshotsPath, "utf8"));
    const rows = Object.keys(snapshots.sources || {}).map(function (key) {
      return snapshots.sources[key];
    });
    const reachableRows = rows.filter(function (row) {
      return row && row.reachable === true;
    });
    const v2Rows = reachableRows.filter(function (row) {
      return row.regionHash && row.regionHash.length === 64 && row.regionTextLength > 0;
    });
    check(
      "snapshots include regionHash (v2 baseline)",
      reachableRows.length > 0 && v2Rows.length >= Math.floor(reachableRows.length * 0.9)
    );
  } else {
    check("snapshots include regionHash (v2 baseline)", false);
  }

  console.log(JSON.stringify({ VALIDATE_PATROL_V2_CORE: errors.length === 0 ? "PASS" : "FAIL", checks }, null, 2));

  if (errors.length) {
    console.error("FAILED: " + errors.join(", "));
    process.exit(1);
  }
}

main();
