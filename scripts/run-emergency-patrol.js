#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "monitor", "reports");

const { getActiveEmergencySources, toPatrolSource } = require("../monitor/emergency-sources");
const { fetchEmergencySource } = require("../monitor/emergency-fetcher");
const { processEmergencyResults } = require("../monitor/emergency-diff-engine");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadFixturePosts() {
  const fixturePath = path.join(ROOT, "monitor", "fixtures", "emergency-x-posts.json");
  if (!fs.existsSync(fixturePath)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return data.posts || [];
}

async function main() {
  const useFixture = process.argv.includes("--fixture");
  const emergencySources = getActiveEmergencySources();
  const patrolSources = emergencySources.map(toPatrolSource);
  const parsedResults = {};
  const patrolAt = new Date().toISOString();
  const fetchOptions = useFixture ? { fixturePosts: loadFixturePosts() } : null;

  for (const source of patrolSources) {
    parsedResults[source.id] = await fetchEmergencySource(source, fetchOptions);
  }

  const diffResult = processEmergencyResults(patrolSources, parsedResults);

  const report = {
    patrolAt,
    patrolType: "EMERGENCY",
    manualOnly: true,
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    EMERGENCY_SOURCE_COUNT: patrolSources.length,
    PATROL_SUCCESS_COUNT: diffResult.successCount,
    PATROL_FAILED_COUNT: diffResult.failedCount,
    CHANGE_DETECTED_COUNT: diffResult.changeCount,
    EMERGENCY_CANDIDATE_COUNT: diffResult.candidateCount,
    candidatePath: diffResult.candidatePath,
    fixtureMode: useFixture,
    NO_PUBLIC_DATA_CHANGE: true,
    AUTO_PUBLICATION: false
  };

  ensureDir(REPORTS_DIR);
  const stamp = patrolAt.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "emergency-patrol-" + stamp + ".json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("=== Kumamoto Disaster Portal Emergency Patrol ===");
  console.log(JSON.stringify(report, null, 2));

  if (diffResult.failedCount > 0 && diffResult.successCount === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
