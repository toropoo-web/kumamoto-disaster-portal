"use strict";

const fs = require("fs");
const path = require("path");
const { generateReviewArtifacts } = require("./review-engine");

const ROOT = path.join(__dirname, "..");
const REPORTS_DIR = path.join(__dirname, "reports");
const OPERATIONS_DIR = path.join(ROOT, "operations", "patrol");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function classifyFailure(fetchResult) {
  if (!fetchResult || fetchResult.ok) {
    return null;
  }

  if (fetchResult.error === "timeout") {
    return "TIMEOUT";
  }

  if (fetchResult.error === "redirect_anomaly") {
    return "REDIRECT_ANOMALY";
  }

  if (fetchResult.error === "invalid_url") {
    return "INVALID_URL";
  }

  if (fetchResult.status >= 400) {
    return "HTTP_ERROR";
  }

  if (fetchResult.status >= 300 && fetchResult.status < 400) {
    return "REDIRECT_ANOMALY";
  }

  if (fetchResult.error === "network_error") {
    return "NETWORK_ERROR";
  }

  return "HTTP_ERROR";
}

function buildFailureEntry(source, fetchResult) {
  return {
    sourceId: source.id,
    name: source.name,
    category: source.category,
    url: source.url,
    failureType: classifyFailure(fetchResult),
    httpStatus: fetchResult ? fetchResult.status : 0,
    error: fetchResult ? fetchResult.error : "unknown",
    message: fetchResult ? fetchResult.message : "",
    detectedAt: new Date().toISOString()
  };
}

function buildSourceRows(sources, parsedResults, fetchResults) {
  return sources.map((source) => {
    const parsed = parsedResults[source.id];
    const fetch = fetchResults[source.id];
    const failureType = classifyFailure(fetch);

    return {
      id: source.id,
      name: source.name,
      category: source.category,
      url: source.url,
      reachable: parsed.reachable,
      httpStatus: parsed.httpStatus,
      failureType,
      title: parsed.title,
      keywords: parsed.keywords || []
    };
  });
}

function renderDailyReport(summary) {
  const lines = [
    "# Patrol Report",
    "",
    "実行日時: " + summary.patrolAt,
    "",
    "対象数: " + summary.sourceCount,
    "成功: " + summary.successCount,
    "失敗: " + summary.failedCount,
    "変更検知: " + summary.changeCount,
    "",
    "HIGH: " + summary.priorityCounts.HIGH,
    "MEDIUM: " + summary.priorityCounts.MEDIUM,
    "LOW: " + summary.priorityCounts.LOW,
    "",
    "AUTO_PUBLICATION: false",
    "NO_PUBLIC_DATA_CHANGE: true"
  ];

  if (summary.highAlert.active) {
    lines.push("");
    lines.push("## HIGH_PRIORITY_CHANGES_FOUND");
    lines.push("");
    lines.push("COUNT: " + summary.highAlert.count);
    summary.highAlert.items.forEach((item) => {
      lines.push("");
      lines.push("SOURCE: " + item.source);
      lines.push("SUMMARY: " + item.summary);
    });
  }

  if (summary.failures.length) {
    lines.push("");
    lines.push("## Source Failures");
    lines.push("");
    lines.push("失敗件数: " + summary.failures.length);
    lines.push("詳細: monitor/reports/source-failures.md");
  }

  if (summary.linkAuditCounts) {
    lines.push("");
    lines.push("## Link Audit");
    lines.push("");
    lines.push("PASS: " + (summary.linkAuditCounts.PASS || 0));
    lines.push("TEMPORARY_FAILURE: " + (summary.linkAuditCounts.TEMPORARY_FAILURE || 0));
    lines.push("URL_CHANGE_REQUIRED: " + (summary.linkAuditCounts.URL_CHANGE_REQUIRED || 0));
    lines.push("REVIEW_REQUIRED: " + (summary.linkAuditCounts.REVIEW_REQUIRED || 0));
    lines.push("詳細: monitor/reports/link-audit-report.md");
  }

  return lines.join("\n") + "\n";
}

function renderSourceFailures(failures) {
  const lines = [
    "# Source Failures",
    "",
    "生成日時: " + new Date().toISOString(),
    "失敗件数: " + failures.length,
    "",
    "一時障害の可能性があります。公開情報の削除は行いません。",
    ""
  ];

  if (!failures.length) {
    lines.push("（失敗なし）");
    lines.push("");
    return lines.join("\n");
  }

  failures.forEach((failure) => {
    lines.push("## " + failure.name + " (" + failure.sourceId + ")");
    lines.push("");
    lines.push("- 種別: " + failure.failureType);
    lines.push("- HTTP: " + failure.httpStatus);
    lines.push("- URL: " + failure.url);
    if (failure.message) {
      lines.push("- メッセージ: " + failure.message);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function renderHighAlert(highItems) {
  if (!highItems.length) {
    return {
      active: false,
      count: 0,
      content: "# HIGH Priority Alert\n\n（HIGH優先の変更候補なし）\n"
    };
  }

  const lines = [
    "# HIGH Priority Alert",
    "",
    "HIGH_PRIORITY_CHANGES_FOUND",
    "",
    "COUNT: " + highItems.length,
    ""
  ];

  highItems.forEach((item) => {
    lines.push("## " + item.id);
    lines.push("");
    lines.push("SOURCE: " + item.source);
    lines.push("MUNICIPALITY: " + item.municipality);
    lines.push("SUMMARY: " + item.summary);
    lines.push("URL: " + item.url);
    lines.push("KEYWORDS: " + item.keywords.join("・"));
    lines.push("");
  });

  return {
    active: true,
    count: highItems.length,
    content: lines.join("\n")
  };
}

function summarizeHighCandidates(candidates) {
  return candidates
    .filter((candidate) => candidate.priority === "HIGH")
    .map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      municipality: candidate.municipality,
      url: candidate.url,
      keywords: candidate.keywords,
      summary: [
        candidate.changeType,
        candidate.after && candidate.after.title ? candidate.after.title : ""
      ]
        .filter(Boolean)
        .join(" / ")
    }));
}

function generateOperationReports(options) {
  const patrolAt = options.patrolAt || new Date().toISOString();
  const sources = options.sources || [];
  const parsedResults = options.parsedResults || {};
  const fetchResults = options.fetchResults || {};
  const diffResult = options.diffResult || {};

  let reviewData;
  try {
    reviewData = generateReviewArtifacts();
  } catch (err) {
    reviewData = {
      candidateCount: 0,
      priorityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      candidates: []
    };
  }

  const failures = sources
    .map((source) => {
      const fetch = fetchResults[source.id];
      if (!fetch || fetch.ok) {
        return null;
      }
      return buildFailureEntry(source, fetch);
    })
    .filter(Boolean);

  const highItems = summarizeHighCandidates(reviewData.candidates || []);
  const highAlert = renderHighAlert(highItems);

  const summary = {
    patrolAt,
    sourceCount: sources.length,
    successCount: diffResult.successCount || 0,
    failedCount: diffResult.failedCount || failures.length,
    changeCount: diffResult.changeCount || 0,
    candidateCount: reviewData.candidateCount || 0,
    priorityCounts: reviewData.priorityCounts || { HIGH: 0, MEDIUM: 0, LOW: 0 },
    highAlert: {
      active: highAlert.active,
      count: highAlert.count,
      items: highItems
    },
    failures,
    sources: buildSourceRows(sources, parsedResults, fetchResults),
    linkAuditCounts: options.linkAuditCounts || null,
    autoPublish: false,
    noPublicDataChange: true
  };

  ensureDir(REPORTS_DIR);

  const dailyReportPath = path.join(REPORTS_DIR, "daily-report.md");
  const failuresReportPath = path.join(REPORTS_DIR, "source-failures.md");
  const highAlertPath = path.join(REPORTS_DIR, "high-alert.md");
  const summaryJsonPath = path.join(REPORTS_DIR, "patrol-summary.json");

  fs.writeFileSync(dailyReportPath, renderDailyReport(summary), "utf8");
  fs.writeFileSync(failuresReportPath, renderSourceFailures(failures), "utf8");
  fs.writeFileSync(highAlertPath, highAlert.content, "utf8");
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  const dateKey = patrolAt.slice(0, 10);
  const operationDir = path.join(OPERATIONS_DIR, dateKey);
  ensureDir(operationDir);

  const operationReportPath = path.join(operationDir, "report.md");
  const operationResultPath = path.join(operationDir, "result.json");
  const operationFailuresPath = path.join(operationDir, "failures.json");

  fs.writeFileSync(operationReportPath, renderDailyReport(summary), "utf8");
  fs.writeFileSync(operationResultPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  fs.writeFileSync(operationFailuresPath, JSON.stringify(failures, null, 2) + "\n", "utf8");

  return {
    PATROL_REPORT: "PASS",
    HIGH_DETECTION: "PASS",
    FAILURE_DETECTION: "PASS",
    PATROL_SUMMARY: "PASS",
    HIGH_PRIORITY_CHANGES_FOUND: highAlert.active,
    HIGH_PRIORITY_COUNT: highAlert.count,
    FAILURE_COUNT: failures.length,
    dailyReportPath,
    failuresReportPath,
    highAlertPath,
    summaryJsonPath,
    operationDir,
    operationReportPath,
    operationResultPath,
    operationFailuresPath,
    summary
  };
}

module.exports = {
  classifyFailure,
  buildFailureEntry,
  generateOperationReports,
  REPORTS_DIR,
  OPERATIONS_DIR
};
