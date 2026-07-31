#!/usr/bin/env node
"use strict";

const { writeOperationMonitorReport } = require("../monitor/operation-monitor");

function main() {
  const result = writeOperationMonitorReport();
  const report = result.report;

  console.log("=== Disaster Portal Operation Monitor ===");
  console.log(JSON.stringify({
    DISASTER_PORTAL_OPERATION_MONITORING_READY: report.DISASTER_PORTAL_OPERATION_MONITORING_READY,
    timestamp: report.timestamp,
    patrol_status: {
      last_patrol_at: report.patrol_status.last_patrol_at,
      pipeline_connected: report.patrol_status.pipeline_connected,
      classifiable_changes: report.patrol_status.classifiable_change_count,
      metadata_ignored: report.patrol_status.metadata_only_ignored_count
    },
    diff_summary: {
      total: report.diff_summary.total_changes,
      classified: report.diff_summary.classified_changes,
      ignored: report.diff_summary.ignored_changes
    },
    review_pending: {
      pending_count: report.review_pending.pending_count,
      category_summary: report.review_pending.category_summary
    },
    public_update_status: report.public_update_status,
    ui_integrity: {
      municipality_count: report.ui_integrity.municipality_count,
      schema_valid: report.ui_integrity.schema_valid
    },
    incident_count: report.incidents.length,
    validation_result: report.validation_result.status,
    output: {
      latest: result.latestPath,
      summary: result.summaryPath
    },
    errors: report.errors
  }, null, 2));

  if (report.DISASTER_PORTAL_OPERATION_MONITORING_READY !== "PASS") {
    process.exit(1);
  }
}

main();
