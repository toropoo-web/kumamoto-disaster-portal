#!/usr/bin/env node
"use strict";

const { applyApproved } = require("../monitor/apply-engine");

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await applyApproved({ apply });

  const summary = {
    MODE: apply ? "APPLY" : "DRY_RUN",
    APPLIED: result.applied === true,
    APPROVED_COUNT: result.approvedCount || 0,
    PREVIEW_COUNT: result.previewCount || 0,
    PUBLIC_DATA_AUTO_MODIFY: result.applied === true,
    previews: result.previews || [],
    errors: result.errors || []
  };

  console.log("=== Apply Approved Updates ===");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
