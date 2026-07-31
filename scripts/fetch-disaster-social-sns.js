#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { REGION_KYUSHU_SOUTH } = require(path.join(__dirname, "..", "monitor", "disaster-sources"));
const {
  INBOX_FILE,
  AUTO_PUBLISH
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));
const { fetchDisasterSocialSnsInbox } = require(path.join(__dirname, "..", "monitor", "disaster-social-sns-fetch"));

function parseArgs(argv) {
  const options = {
    inboxPath: INBOX_FILE,
    merge: false
  };
  (argv || []).forEach(function (arg) {
    if (arg === "--merge") {
      options.merge = true;
    } else if (arg.indexOf("--inbox=") === 0) {
      options.inboxPath = arg.slice("--inbox=".length);
    }
  });
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fetchResult = await fetchDisasterSocialSnsInbox();
  let items = fetchResult.items.slice();

  if (options.merge && fs.existsSync(options.inboxPath)) {
    const existing = JSON.parse(fs.readFileSync(options.inboxPath, "utf8"));
    const seen = new Set(items.map(function (item) {
      return item.dedupe_key;
    }));
    (existing.items || []).forEach(function (item) {
      if (!item.dedupe_key || seen.has(item.dedupe_key)) {
        return;
      }
      seen.add(item.dedupe_key);
      items.push(item);
    });
  }

  const payload = {
    version: "1.1",
    region: REGION_KYUSHU_SOUTH,
    AUTO_PUBLISH: AUTO_PUBLISH,
    acquisition_mode: "SNS_AUTO_FETCH",
    description: "SNS自動取得Inbox（本番運用）",
    last_fetched_at: fetchResult.fetched_at,
    fetch_summary: {
      since_date: fetchResult.since_date,
      platforms: fetchResult.platforms,
      municipality_summary: fetchResult.municipality_summary,
      category_summary: fetchResult.category_summary
    },
    items: items
  };

  fs.writeFileSync(options.inboxPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  const byPlatform = { X: 0 };
  items.forEach(function (item) {
    if (item.source_type === "X") {
      byPlatform.X += 1;
    }
  });

  console.log("=== Disaster Social SNS Fetch ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_SNS_FETCH: "COMPLETE",
        inbox_path: options.inboxPath,
        inbox_item_count: items.length,
        platform_counts: byPlatform,
        municipality_count: Object.keys(fetchResult.municipality_summary).length,
        fetch_summary: fetchResult.platforms
      },
      null,
      2
    )
  );
  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_SNS_FETCH_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
