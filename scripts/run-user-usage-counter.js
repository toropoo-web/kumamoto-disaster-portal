#!/usr/bin/env node
"use strict";

const { writeUserUsageCounter } = require("../monitor/user-usage-counter");

function main() {
  const result = writeUserUsageCounter();

  console.log("=== User Usage Counter ===");
  console.log(
    JSON.stringify(
      {
        USER_USAGE_COUNTER: result.ok ? "PASS" : "FAIL",
        page_views: result.report && result.report.page_views,
        today_views: result.report && result.report.today_views,
        events: result.report && result.report.events,
        last_access_at: result.report && result.report.last_access_at,
        output: result.outputPath || null,
        errors: result.errors
      },
      null,
      2
    )
  );

  if (!result.ok) {
    process.exit(1);
  }

  console.log("PHASE39B2_USER_USAGE_COUNTER_COMPLETE");
}

main();
