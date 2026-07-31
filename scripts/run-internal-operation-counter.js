#!/usr/bin/env node
"use strict";

const { writeInternalOperationCounter } = require("../monitor/internal-operation-counter");

function main() {
  const dryRun = process.argv.indexOf("--dry-run") >= 0;
  const result = writeInternalOperationCounter({ recordGeneration: !dryRun });

  console.log("=== Internal Operation Counter ===");
  console.log(
    JSON.stringify(
      {
        INTERNAL_OPERATION_COUNTER: result.ok ? "PASS" : "FAIL",
        page_view_count: result.report && result.report.page_view_count,
        operator_report_count: result.report && result.report.operator_report_count,
        category_usage_count: result.report && result.report.category_usage_count,
        last_access_time: result.report && result.report.last_access_time,
        patrol_status_summary: result.report && result.report.patrol_status_summary,
        output: result.outputPath || null,
        state: result.statePath || null,
        errors: result.errors
      },
      null,
      2
    )
  );

  if (!result.ok) {
    process.exit(1);
  }

  console.log("PHASE39B_INTERNAL_OPERATION_COUNTER_COMPLETE");
}

main();
