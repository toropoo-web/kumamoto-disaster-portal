#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const REPORTS_DIR = path.join(ROOT, "monitor", "reports");

const { fetchSource } = require("../monitor/crawler");
const { parsePage } = require("../monitor/parser");
const { processResults } = require("../monitor/diff-engine");

function loadSources() {
  const data = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  return data.municipalities.concat(data.communication);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function patrolSource(source) {
  const fetched = await fetchSource(source.url);
  const parsed = parsePage(fetched);
  return parsed;
}

async function main() {
  const sources = loadSources();
  const parsedResults = {};

  for (const source of sources) {
    parsedResults[source.id] = await patrolSource(source);
  }

  const diffResult = processResults(sources, parsedResults);
  const report = {
    patrolAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    PATROL_SOURCE_COUNT: sources.length,
    PATROL_SUCCESS_COUNT: diffResult.successCount,
    PATROL_FAILED_COUNT: diffResult.failedCount,
    CHANGE_DETECTED_COUNT: diffResult.changeCount,
    UPDATE_CANDIDATE_COUNT: diffResult.candidateCount,
    DIFF_GENERATION: "PASS",
    NO_PUBLIC_DATA_CHANGE: true,
    changeLogPath: diffResult.changeLogPath,
    candidatePath: diffResult.candidatePath,
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      category: source.category,
      url: source.url,
      reachable: parsedResults[source.id].reachable,
      httpStatus: parsedResults[source.id].httpStatus,
      title: parsedResults[source.id].title,
      contentHash: parsedResults[source.id].contentHash,
      keywords: parsedResults[source.id].keywords
    }))
  };

  ensureDir(REPORTS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "patrol-" + stamp + ".json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("=== Kumamoto Disaster Portal Patrol ===");
  console.log(JSON.stringify(report, null, 2));

  if (diffResult.failedCount > 0 && diffResult.successCount === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
