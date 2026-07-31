#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MONITOR_OUTPUT_DIR = path.join(ROOT, "data", "operation_monitor");

const {
  buildOperationMonitorReport,
  writeOperationMonitorReport,
  collectPatrolStatus,
  collectReviewPending,
  collectPublicUpdateStatus
} = require("../monitor/operation-monitor");

const {
  classifyChangeLogEntries,
  isClassifiableChangeEntry
} = require("../monitor/diff-classification");

function check(name, pass, reason) {
  return { check: name, status: pass ? "PASS" : "FAIL", reason: reason || null };
}

function statusFrom(checks) {
  return checks.some(function (item) {
    return item.status === "FAIL";
  })
    ? "FAIL"
    : "PASS";
}

function validateMonitoringInfrastructure() {
  const checks = [];
  const required = [
    "monitor/operation-monitor.js",
    "scripts/run-operation-monitor.js",
    "scripts/run-patrol-pipeline.js",
    "data/review_queue/patrol_review_queue.json",
    "data/public_update_queue/patrol_public_update_queue.json",
    "data/public_update_gate/patrol_public_update_gate.json",
    "data/public_update_apply/public_update_apply_queue.json"
  ];

  required.forEach(function (file) {
    checks.push(check("infra." + file.replace(/[\\/]/g, "."), fs.existsSync(path.join(ROOT, file))));
  });

  return checks;
}

function validatePatrolOperationRules() {
  const checks = [];
  const patrol = collectPatrolStatus();

  checks.push(check("patrol.pipeline_connected", patrol.pipeline_connected));
  checks.push(check("patrol.page_updated_at_excluded", patrol.page_updated_at_excluded));
  checks.push(check("patrol.classification_on_hash_change", patrol.hash_change_triggers_classification));

  const pageUpdatedOnly = classifyChangeLogEntries(
    [{
      source: "TEST-monitor",
      sourceName: "テスト",
      changeType: "PAGE_UPDATED_AT_CHANGED",
      previousHash: "same",
      currentHash: "same",
      keywords: ["避難所"]
    }],
    { sources: {} }
  );
  checks.push(check("patrol.PAGE_UPDATED_AT_no_classification", pageUpdatedOnly.length === 0));

  const contentChanged = classifyChangeLogEntries(
    [{
      source: "TEST-monitor",
      sourceName: "テスト",
      url: "https://example.test",
      changeType: "CONTENT_CHANGED",
      previousHash: "before",
      currentHash: "after",
      keywords: ["断水"]
    }],
    { sources: {} }
  );
  checks.push(check("patrol.CONTENT_CHANGED_classification", contentChanged.length >= 1));
  checks.push(check("patrol.no_diff_stops", classifyChangeLogEntries([], { sources: {} }).length === 0));
  checks.push(check("patrol.isClassifiableChangeEntry", isClassifiableChangeEntry({
    changeType: "PAGE_UPDATED_AT_CHANGED",
    previousHash: "a",
    currentHash: "a"
  }) === false));

  return checks;
}

function validateReviewQueueOperation() {
  const checks = [];
  const review = collectReviewPending();

  checks.push(check("review.pending_count_available", typeof review.pending_count === "number"));
  checks.push(check("review.category_summary_available", Boolean(review.category_summary)));
  checks.push(check("review.decision_log_present", review.decision_log_file !== null));
  checks.push(check("review.auto_publish_false", review.auto_publish === true));
  checks.push(check("review.source_trace_missing_zero", review.source_trace_missing_count === 0));
  checks.push(check("review.schema_errors_zero", review.schema_error_count === 0));

  return checks;
}

function validatePublicUpdateMonitoring() {
  const checks = [];
  const status = collectPublicUpdateStatus();

  checks.push(check("public_update.queue_file_present", fs.existsSync(path.join(ROOT, status.files.queue))));
  checks.push(check("public_update.gate_file_present", fs.existsSync(path.join(ROOT, status.files.gate))));
  checks.push(check("public_update.apply_file_present", fs.existsSync(path.join(ROOT, status.files.apply))));
  checks.push(check("public_update.auto_apply_prohibited", status.auto_apply_prohibited));
  checks.push(check("public_update.confirm_required", status.confirm_required));
  checks.push(check("public_update.auto_publish_false", status.auto_publish_false));

  return checks;
}

function validateReportOutput() {
  const checks = [];
  const writeResult = writeOperationMonitorReport();
  const report = writeResult.report;

  checks.push(check("report.DISASTER_PORTAL_OPERATION_MONITORING_READY", report.DISASTER_PORTAL_OPERATION_MONITORING_READY === "PASS"));
  checks.push(check("report.patrol_status", Boolean(report.patrol_status)));
  checks.push(check("report.diff_summary", Boolean(report.diff_summary)));
  checks.push(check("report.review_pending", Boolean(report.review_pending)));
  checks.push(check("report.public_update_status", Boolean(report.public_update_status)));
  checks.push(check("report.validation_result", Boolean(report.validation_result)));
  checks.push(check("report.timestamp", Boolean(report.timestamp)));
  checks.push(check("report.latest_file_written", fs.existsSync(writeResult.latestPath)));
  checks.push(check("report.summary_file_written", fs.existsSync(writeResult.summaryPath)));

  const requiredConstraintKeys = [
    "auto_municipality_add",
    "sources_json_auto_change",
    "auto_publish",
    "auto_approval",
    "public_data_direct_edit"
  ];
  requiredConstraintKeys.forEach(function (key) {
    checks.push(check("constraints." + key + "_false", report.constraints[key] === false));
  });

  return { checks: checks, report: report };
}

function main() {
  const errors = [];
  const sections = {};

  sections.infrastructure = {
    checks: validateMonitoringInfrastructure(),
    status: "PENDING"
  };
  sections.patrol_operation = {
    checks: validatePatrolOperationRules(),
    status: "PENDING"
  };
  sections.review_queue = {
    checks: validateReviewQueueOperation(),
    status: "PENDING"
  };
  sections.public_update = {
    checks: validatePublicUpdateMonitoring(),
    status: "PENDING"
  };

  const reportOutput = validateReportOutput();
  sections.report_output = {
    checks: reportOutput.checks,
    status: "PENDING"
  };

  Object.keys(sections).forEach(function (key) {
    sections[key].status = statusFrom(sections[key].checks);
    sections[key].checks.forEach(function (item) {
      if (item.status === "FAIL") {
        errors.push(key + ": " + item.check + (item.reason ? " (" + item.reason + ")" : ""));
      }
    });
  });

  const overallPass = errors.length === 0;
  const output = {
    DISASTER_PORTAL_OPERATION_MONITORING_READY: overallPass ? "PASS" : "FAIL",
    generatedAt: new Date().toISOString(),
    scope: reportOutput.report.scope,
    sections: sections,
    monitor_report: path.relative(ROOT, path.join(MONITOR_OUTPUT_DIR, "latest-report.json")),
    errors: errors
  };

  if (!fs.existsSync(MONITOR_OUTPUT_DIR)) {
    fs.mkdirSync(MONITOR_OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(
    path.join(MONITOR_OUTPUT_DIR, "monitoring-ready-report.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("=== Operation Monitoring Setup Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (!overallPass) {
    process.exit(1);
  }
}

main();
