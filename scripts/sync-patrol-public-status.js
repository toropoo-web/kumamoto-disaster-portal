#!/usr/bin/env node
"use strict";

const { syncPublicStatusFromLatestPatrol, refreshPhase1TimestampsFromSnapshots, readLatestPatrolReport } = require("../monitor/patrol-publish-pipeline");

function main() {
  const statusResult = syncPublicStatusFromLatestPatrol();
  const latestPatrol = readLatestPatrolReport();
  const timestampResult = refreshPhase1TimestampsFromSnapshots(
    latestPatrol ? latestPatrol.patrolAt : null
  );
  const result = Object.assign({}, statusResult, {
    phase1_timestamp_refresh: timestampResult
  });

  console.log("=== Sync Patrol Public Status ===");
  console.log(JSON.stringify(result, null, 2));

  if (!result.saved) {
    console.error("SYNC_PATROL_PUBLIC_STATUS_FAIL: " + (result.reason || "unknown"));
    process.exit(1);
  }

  console.log("SYNC_PATROL_PUBLIC_STATUS_COMPLETE");
}

main();
