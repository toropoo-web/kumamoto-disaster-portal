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
const { generateOperationReports, renderDailyReport } = require("../monitor/operation-report");
const { runUrlAudit } = require("../monitor/url-audit");
const { saveOperationStatus } = require("../monitor/operation-status");
const { savePublicStatus } = require("../monitor/public-status");
const { getMunicipalityPatrolSources } = require("../monitor/municipality-patrol-sources");
const {
  ensureMunicipalityEmergencyFallbacks
} = require("../monitor/municipality-emergency-fallback");
const { fetchPageForPatrol } = require("../monitor/patrol-v2/fetch-orchestrator");
const { filterMunicipalityPatrolSources } = require("../monitor/patrol-v2/source-guard");
const {
  dispatchPatrolAlert,
  dispatchPatrolSummary
} = require("../monitor/patrol-v2/alert-dispatcher");

function loadSources() {
  const data = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  const merged = getMunicipalityPatrolSources().concat(data.communication);
  return filterMunicipalityPatrolSources(merged);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function patrolSource(source) {
  const useV2 = process.env.PATROL_FETCH_V2 !== "0";
  let fetched;
  let feedFingerprint = "";
  let feedUrl = "";

  try {
    if (useV2) {
      const orchestrated = await fetchPageForPatrol(source);
      fetched = orchestrated.fetched;
      feedFingerprint = orchestrated.meta.feedFingerprint || "";
      feedUrl = orchestrated.meta.feedUrl || "";

      if (orchestrated.meta.error) {
        await dispatchPatrolAlert({
          level: "ERROR",
          summary: "巡回オーケストレータ例外: " + source.id,
          detail: source.url + "\n" + orchestrated.meta.error
        });
      }
    } else {
      fetched = await fetchSource(source.url);
    }
  } catch (err) {
    await dispatchPatrolAlert({
      level: "ERROR",
      summary: "巡回取得例外: " + source.id,
      detail: source.url + "\n" + err.message
    });
    fetched = {
      ok: false,
      url: source.url,
      originalUrl: source.url,
      finalUrl: source.url,
      status: 0,
      redirectCount: 0,
      error: "patrol_exception",
      message: err.message,
      body: "",
      bodyBuffer: Buffer.alloc(0),
      charset: "utf-8",
      headers: {},
      fetchMode: "error"
    };
  }

  if (!fetched.ok) {
    await dispatchPatrolAlert({
      level: "WARNING",
      summary: "取得失敗: " + source.id,
      detail:
        source.url +
        "\nstatus=" +
        fetched.status +
        " error=" +
        (fetched.error || "") +
        " " +
        (fetched.message || "")
    });
  }

  const parsed = parsePage(fetched, {
    preferArticleUpdatedAt: source.prefer_article_updated_at === true,
    feedFingerprint: feedFingerprint,
    feedUrl: feedUrl
  });
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
  const emergencyFallbackResult = ensureMunicipalityEmergencyFallbacks({
    checkedAt: patrolAt
  });
  const urlAudit = await runUrlAudit({ save: true });
  const operation = generateOperationReports({
    patrolAt,
    sources,
    parsedResults,
    fetchResults,
    diffResult,
    linkAuditCounts: urlAudit.summary.counts
  });

  const operationStatus = await saveOperationStatus({ patrolAt });
  let publicStatusResult = { saved: false };

  if (diffResult.successCount > 0) {
    publicStatusResult = savePublicStatus({
      patrolAt,
      sourceCount: sources.length,
      successCount: diffResult.successCount,
      lastValidationAt: operationStatus.currentStatus.LAST_VALIDATION,
      systemStatus: operationStatus.currentStatus.PUBLIC_STATUS
    });
  }

  const summaryWithStatus = Object.assign({}, operation.summary, {
    currentStatus: operationStatus.currentStatus
  });
  const dailyReport = renderDailyReport(summaryWithStatus);
  fs.writeFileSync(operation.dailyReportPath, dailyReport, "utf8");
  fs.writeFileSync(path.join(operation.operationDir, "report.md"), dailyReport, "utf8");

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
    linkAuditPath: urlAudit.artifacts.reportPath,
    linkAuditCounts: urlAudit.summary.counts,
    currentStatus: operationStatus.currentStatus,
    publicStatusUpdated: publicStatusResult.saved === true,
    publicStatusPath: publicStatusResult.saved ? publicStatusResult.statusPath : null,
    sources: operation.summary.sources,
    municipalityEmergencyFallback: emergencyFallbackResult
  };

  ensureDir(REPORTS_DIR);
  const stamp = patrolAt.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, "patrol-" + stamp + ".json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const failureSample = (operation.summary.failures || [])
    .slice(0, 5)
    .map(function (item) {
      return item.source + " " + item.url;
    })
    .join("\n");

  await dispatchPatrolSummary({
    failedCount: diffResult.failedCount,
    successCount: diffResult.successCount,
    highPriorityCount: operation.HIGH_PRIORITY_COUNT || 0,
    failureSample: failureSample
  });

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

  if (urlAudit.summary.counts.URL_CHANGE_REQUIRED > 0) {
    console.log("");
    console.log("=== URL_CHANGE_REQUIRED ===");
    urlAudit.summary.results
      .filter((item) => item.status === "URL_CHANGE_REQUIRED")
      .forEach((item) => {
        console.log("NAME: " + item.name);
        console.log("URL: " + item.url);
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
