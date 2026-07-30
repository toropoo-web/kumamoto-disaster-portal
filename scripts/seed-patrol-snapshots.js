#!/usr/bin/env node
"use strict";

const { seedAllSnapshotsIfMissing } = require("../monitor/patrol-snapshot-store");

function main() {
  const results = seedAllSnapshotsIfMissing();

  console.log("=== Seed Patrol Snapshots ===");
  console.log(JSON.stringify({ results: results }, null, 2));

  const seeded = results.some(function (item) {
    return item.seeded;
  });

  if (!results.some(function (item) {
    return item.reason === "exists" || item.seeded;
  })) {
    process.exit(1);
  }

  if (!seeded) {
    console.log("SNAPSHOT_SEED: already_present");
  }
}

main();
