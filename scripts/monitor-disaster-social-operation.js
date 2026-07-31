#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  writeDisasterSocialOperationReport
} = require(path.join(__dirname, "..", "monitor", "disaster-social-operation-monitor"));

function parseArgs(argv) {
  const options = {};
  (argv || []).forEach(function (arg) {
    if (arg.indexOf("--output=") === 0) {
      options.outputPath = arg.slice("--output=".length);
    }
  });
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = writeDisasterSocialOperationReport(options);

  console.log("=== Disaster Social Operation Monitor ===");
  console.log(JSON.stringify(result.report, null, 2));
  console.log("OUTPUT_FILE=" + result.output_path);
  console.log("DISASTER_SOCIAL_OPERATION_MONITOR_COMPLETE");
}

main();
