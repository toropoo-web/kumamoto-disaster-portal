#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  buildAndWriteDisasterPostIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-post-index-engine"));

async function main() {
  const payload = await buildAndWriteDisasterPostIndex();

  console.log("=== Disaster Post Index Build ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "PHASE50_DISASTER_CROSS_SEARCH_POST_INGESTION",
        VERSION: payload.version,
        REGION: payload.region,
        ITEM_COUNT: payload.meta.item_count,
        SOURCE: payload.meta.source,
        LAST_UPDATED: payload.meta.last_updated
      },
      null,
      2
    )
  );
}

main().catch(function (err) {
  console.error("=== Disaster Post Index Build ===");
  console.error(JSON.stringify({ STATUS: "FAIL", error: err.message }, null, 2));
  process.exit(1);
});
