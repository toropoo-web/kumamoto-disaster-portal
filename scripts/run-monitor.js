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
const { generateOperationReports } = require("../monitor/operation-report");

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
  return { fetched, parsed };
}

async function main() {
  const sources = loadSources();
  const parsedResults = {};
  const fetchResults = {};
  const patrolAt = new Date().toISOString();

  for (const source of sources) {
    const result = await patrolSource(source);
    fetchResults[source.id] = result.fetched;
    parsedResults[source.id] = result.parsed;
  }

  const diffResult = processResults(sources, parsedResults);
  const operation = generateOperationReports({
    patrolAt,
    sources,
    parsedResults,
    fetchResults,
    diffResult
  });

  const report = {
    patrolAt,
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    PATROL_SOURCE_COUNT: sources.length,
    PATROL_SUCCESS_COUNT: diffResult.successCount,
    PATROL_FAILED_COUNT: diffResult.failedCount,
    CHANGE_DETECTED_COUNT: diffResult.changeCount,
    UPDATE_CANDIDATE_COUNT: diffResult.candidateCount,
    HIGH_PRIORITY_CHANGES_FOUND: operation.HIGH_PRIORITY_CHANGES_FOUND,
    HIGH_PRIORITY_COUNT: operation.HIGH_PRIORITY_COUNT,
    FAILURE_COUNT: operation.FAILURE_COUNT,
    DIFF_GENERATION: "PASS",
    PATROL_REPORT: operation.PATROL_REPORT,
    HIGH_DETECTION: operation.HIGH_DETECTION,
    FAILURE_DETECTION: operation.FAILURE_DETECTION,
    NO_PUBLIC_DATA_CHANGE: true,
    AUTO_PUBLICATION: false,
    changeLogPath: diffResult.changeLogPath,
    candidatePath: diffResult.candidatePath,
    dailyReportPath: operation.dailyReportPath,
    failuresReportPath: operation.failuresReportPath,
    highAlertPath: operation.highAlertPath,
    operationDir: operation.operationDir,
    sources: operation.summary.sources
  };

  ensureDir(REPORTS_DIR);
  const stamp = patrolAt.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "patrol-" + stamp + ".json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("=== Kumamoto Disaster Portal Patrol ===");
  console.log(JSON.stringify(report, null, 2));

  if (operation.HIGH_PRIORITY_CHANGES_FOUND) {
    console.log("");
    console.log("=== HIGH_PRIORITY_CHANGES_FOUND ===");
    console.log("COUNT: " + operation.HIGH_PRIORITY_COUNT);
    operation.summary.highAlert.items.forEach((item) => {
      console.log("SOURCE: " + item.source);
      console.log("SUMMARY: " + item.summary);
    });
  }

  if (diffResult.failedCount > 0 && diffResult.successCount === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
