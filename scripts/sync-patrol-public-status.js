#!/usr/bin/env node
"use strict";

const { syncPublicStatusFromLatestPatrol } = require("../monitor/patrol-publish-pipeline");

function main() {
  const result = syncPublicStatusFromLatestPatrol();

  console.log("=== Sync Patrol Public Status ===");
  console.log(JSON.stringify(result, null, 2));

  if (!result.saved) {
    console.error("SYNC_PATROL_PUBLIC_STATUS_FAIL: " + (result.reason || "unknown"));
    process.exit(1);
  }

  console.log("SYNC_PATROL_PUBLIC_STATUS_COMPLETE");
}

main();
