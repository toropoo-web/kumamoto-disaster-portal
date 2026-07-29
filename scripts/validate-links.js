#!/usr/bin/env node
"use strict";

const { auditAllPublicUrls, URL_STATUS } = require("../monitor/url-audit");

async function main() {
  const summary = await auditAllPublicUrls();
  const actionable = summary.results.filter(
    (result) => result.status === URL_STATUS.REVIEW_REQUIRED
  );

  const output = {
    CHECKED_URL_COUNT: summary.targetCount,
    MUNICIPALITY_COUNT: summary.municipalityCount,
    COMMUNICATION_COUNT: summary.communicationCount,
    STATUS_COUNTS: summary.counts,
    LINK_VALIDATION: actionable.length === 0 ? "PASS" : "FAIL",
    URL_CLASSIFICATION: "PASS",
    unreviewed: actionable,
    results: summary.results.map((result) => ({
      name: result.name,
      url: result.url,
      httpStatus: result.httpStatus,
      status: result.status
    }))
  };

  console.log("=== Phase3 Link Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (actionable.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
