#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "monitor", "reports");

const {
  getPatrolInfrastructureSources,
  toPatrolSource,
  PATROL_CATEGORIES
} = require("../monitor/infrastructure-sources");
const { fetchInfrastructureSource } = require("../monitor/infrastructure-fetcher");
const { processInfrastructureResults } = require("../monitor/infrastructure-diff-engine");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadFixtureOverrides() {
  const fixturePath = path.join(ROOT, "monitor", "fixtures", "infrastructure-content.json");
  if (!fs.existsSync(fixturePath)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return data.overrides || null;
}

async function main() {
  const useFixture = process.argv.includes("--fixture");
  const infrastructureSources = getPatrolInfrastructureSources();
  const patrolSources = infrastructureSources.map(toPatrolSource);
  const parsedResults = {};
  const patrolAt = new Date().toISOString();
  const fetchOptions = useFixture ? { contentOverrides: loadFixtureOverrides() } : null;

  for (const source of patrolSources) {
    parsedResults[source.id] = await fetchInfrastructureSource(source, fetchOptions);
  }

  const diffResult = processInfrastructureResults(patrolSources, parsedResults);

  const categoryCounts = {};
  patrolSources.forEach((source) => {
    categoryCounts[source.category] = (categoryCounts[source.category] || 0) + 1;
  });

  const report = {
    patrolAt,
    patrolType: "INFRASTRUCTURE",
    manualOnly: true,
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    INFRASTRUCTURE_SOURCE_COUNT: patrolSources.length,
    PATROL_SUCCESS_COUNT: diffResult.successCount,
    PATROL_FAILED_COUNT: diffResult.failedCount,
    CHANGE_DETECTED_COUNT: diffResult.changeCount,
    INFRASTRUCTURE_CANDIDATE_COUNT: diffResult.candidateCount,
    CATEGORY_COUNTS: categoryCounts,
    PATROL_CATEGORIES: Array.from(PATROL_CATEGORIES),
    candidatePath: diffResult.candidatePath,
    fixtureMode: useFixture,
    NO_PUBLIC_DATA_CHANGE: true,
    AUTO_PUBLICATION: false
  };

  ensureDir(REPORTS_DIR);
  const stamp = patrolAt.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "infrastructure-patrol-" + stamp + ".json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("=== Kumamoto Disaster Portal Infrastructure Patrol ===");
  console.log(JSON.stringify(report, null, 2));

  if (diffResult.failedCount > 0 && diffResult.successCount === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
