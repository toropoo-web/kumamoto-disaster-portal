#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  buildAndWriteDisasterSocialIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));

function main() {
  const payload = buildAndWriteDisasterSocialIndex();

  console.log("=== Disaster Social Index Build ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "DISASTER_CROSS_SEARCH_COMMUNITY_LAYER",
        SOURCE_COUNT: payload.meta.source_count,
        ENTRY_COUNT: payload.meta.entry_count,
        LAST_UPDATED: payload.meta.last_updated
      },
      null,
      2
    )
  );
}

main();
