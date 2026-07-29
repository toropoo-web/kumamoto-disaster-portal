#!/usr/bin/env node
"use strict";

const { runUrlAudit } = require("../monitor/url-audit");

async function main() {
  const result = await runUrlAudit({ save: true });
  const summary = result.summary;

  const output = {
    auditedAt: summary.auditedAt,
    targetCount: summary.targetCount,
    municipalityCount: summary.municipalityCount,
    communicationCount: summary.communicationCount,
    counts: summary.counts,
    reportPath: result.artifacts.reportPath,
    operationDir: result.artifacts.operationDir,
    PUBLIC_DATA_AUTO_DELETE: false
  };

  console.log("=== URL Audit ===");
  console.log(JSON.stringify(output, null, 2));

  if (summary.counts.URL_CHANGE_REQUIRED > 0) {
    console.log("");
    console.log("=== URL_CHANGE_REQUIRED ===");
    summary.results
      .filter((item) => item.status === "URL_CHANGE_REQUIRED")
      .forEach((item) => {
        console.log("NAME: " + item.name);
        console.log("URL: " + item.url);
        if (item.followUp.notes.length) {
          console.log("NOTE: " + item.followUp.notes.join(" / "));
        }
      });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
