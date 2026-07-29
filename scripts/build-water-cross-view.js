#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  buildAndWriteWaterCrossView
} = require(path.join(__dirname, "..", "monitor", "water-cross-view-engine"));

function main() {
  const payload = buildAndWriteWaterCrossView();

  console.log("=== Water Cross View Build ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "PHASE27_WATER_CROSS_VIEW_IMPLEMENTATION",
        MUNICIPALITY_COUNT: payload.municipality_count,
        LAST_UPDATED: payload.last_updated,
        MUNICIPALITIES: payload.municipalities.map(function (entry) {
          return {
            municipality: entry.municipality,
            location_count: entry.location_count,
            status_label: entry.status_label
          };
        })
      },
      null,
      2
    )
  );
}

main();
