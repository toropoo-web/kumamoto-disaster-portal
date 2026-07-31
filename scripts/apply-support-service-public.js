#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  applySupportServicePublicUpdates
} = require(path.join(__dirname, "..", "monitor", "support-service-public-apply"));

const {
  buildAndWriteDisasterSearchIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const dryRun = process.argv.indexOf("--dry-run") !== -1;
  const applyResult = applySupportServicePublicUpdates({ dryRun: dryRun });

  console.log("=== SUPPORT_SERVICE Public Apply ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "PHASE13_SUPPORT_SERVICE_PUBLIC_APPLY",
        DRY_RUN: dryRun,
        AUTO_PUBLISH: applyResult.AUTO_PUBLISH,
        APPLIED_COUNT: applyResult.appliedCount,
        FAILED_COUNT: applyResult.failedCount,
        SKIPPED_COUNT: applyResult.skippedCount,
        AUDIT_ENTRY_COUNT: applyResult.auditEntryCount,
        INFORMATION_COUNT: applyResult.informationCount,
        RESULTS: applyResult.results
      },
      null,
      2
    )
  );

  if (!applyResult.ok) {
    console.error(JSON.stringify({ errors: applyResult.errors }, null, 2));
    process.exit(1);
  }

  if (!dryRun && applyResult.appliedCount > 0) {
    const indexPayload = buildAndWriteDisasterSearchIndex();
    console.log(
      JSON.stringify(
        {
          INDEX_BUILD: "PASS",
          INDEX_ITEM_COUNT: indexPayload.meta.item_count,
          SUPPORT_SERVICE_REGISTRY_ITEM_COUNT:
            indexPayload.meta.support_service_registry_item_count
        },
        null,
        2
      )
    );
  }

  console.log("PHASE13_SUPPORT_SERVICE_PUBLIC_APPLY_COMPLETE");
}

main();
