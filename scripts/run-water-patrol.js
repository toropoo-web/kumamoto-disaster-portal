#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "monitor", "reports");

const { getActiveWaterSources, toPatrolSource } = require("../monitor/water-sources");
const { fetchWaterSource } = require("../monitor/water-fetcher");
const { processWaterResults } = require("../monitor/water-diff-engine");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadFixtureMap() {
  const fixturePath = path.join(ROOT, "monitor", "fixtures", "water-patrol-fixture.json");
  if (!fs.existsSync(fixturePath)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return data.fixtures || null;
}

function buildFixtureOptions(useFixture, sources) {
  if (!useFixture) {
    return null;
  }

  const templateFixtures = loadFixtureMap() || {};
  const fixtures = {};
  const sample = Object.values(templateFixtures)[0] || {
    reachable: true,
    originalText: "応急給水所のお知らせ。給水車による飲料水配布を実施します。",
    pageUpdatedAt: "2026-07-30T06:00:00+09:00"
  };

  sources.forEach(function (source, index) {
    if (index === 0) {
      fixtures[source.id] = Object.assign({}, sample, {
        originalText: "八代市では応急給水所を設置しています。給水車による生活用水の配布を実施中です。",
        pageUpdatedAt: "2026-07-30T06:00:00+09:00"
      });
    } else {
      fixtures[source.id] = Object.assign({}, sample, {
        originalText: "給水・断水情報の更新はありません。",
        pageUpdatedAt: "2026-07-30T06:00:00+09:00"
      });
    }
  });

  return { fixtures: fixtures };
}

async function main() {
  const useFixture = process.argv.includes("--fixture");
  const waterSources = getActiveWaterSources();
  const patrolSources = waterSources.map(toPatrolSource);
  const parsedResults = {};
  const patrolAt = new Date().toISOString();
  const fetchOptions = buildFixtureOptions(useFixture, patrolSources);

  for (const source of patrolSources) {
    parsedResults[source.id] = await fetchWaterSource(source, fetchOptions);
  }

  const diffResult = processWaterResults(patrolSources, parsedResults);

  const classCounts = {};
  waterSources.forEach(function (source) {
    classCounts[source.source_class] = (classCounts[source.source_class] || 0) + 1;
  });

  const report = {
    patrolAt: patrolAt,
    patrolType: "WATER",
    manualOnly: true,
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    WATER_SOURCE_COUNT: patrolSources.length,
    PATROL_SUCCESS_COUNT: diffResult.successCount,
    PATROL_FAILED_COUNT: diffResult.failedCount,
    CHANGE_DETECTED_COUNT: diffResult.changeCount,
    WATER_REVIEW_COUNT: diffResult.reviewCount,
    SOURCE_CLASS_COUNTS: classCounts,
    reviewQueuePath: diffResult.reviewQueuePath,
    snapshotPath: diffResult.snapshotPath,
    fixtureMode: useFixture,
    NO_PUBLIC_DATA_CHANGE: true,
    AUTO_PUBLICATION: false
  };

  ensureDir(REPORTS_DIR);
  const stamp = patrolAt.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "water-patrol-" + stamp + ".json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("=== Kumamoto Disaster Portal Water Patrol ===");
  console.log(JSON.stringify(report, null, 2));

  if (diffResult.failedCount > 0 && diffResult.successCount === 0) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
