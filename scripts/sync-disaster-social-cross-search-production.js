#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { REGION_KYUSHU_SOUTH } = require(path.join(ROOT, "monitor", "disaster-sources"));
const {
  INBOX_FILE,
  REVIEW_QUEUE_FILE,
  APPLY_QUEUE_FILE,
  AUTO_PUBLISH,
  buildReviewQueueFromInbox,
  buildApplyQueueFromReviewQueue,
  applyDisasterSocialQueue
} = require(path.join(ROOT, "monitor", "disaster-social-pipeline"));
const {
  INDEX_FILE,
  SOURCES_FILE
} = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const { fetchDisasterSocialSnsInbox } = require(path.join(ROOT, "monitor", "disaster-social-sns-fetch"));

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mergeInboxItems(existingItems, incomingItems) {
  const seen = new Set();
  const merged = [];
  existingItems.concat(incomingItems).forEach(function (item) {
    if (!item || !item.dedupe_key || seen.has(item.dedupe_key)) {
      return;
    }
    seen.add(item.dedupe_key);
    merged.push(item);
  });
  return merged;
}

async function main() {
  const fetchResult = await fetchDisasterSocialSnsInbox();
  const existingInbox = readJson(INBOX_FILE, { items: [] });
  const items = mergeInboxItems(existingInbox.items || [], fetchResult.items || []);

  const inbox = {
    version: "1.1",
    region: REGION_KYUSHU_SOUTH,
    AUTO_PUBLISH: AUTO_PUBLISH,
    acquisition_mode: "SNS_SEARCH_CROSS_FETCH",
    description: "SNS横断検索Inbox（本番運用）",
    last_fetched_at: fetchResult.fetched_at,
    fetch_summary: {
      since_date: fetchResult.since_date,
      platforms: fetchResult.platforms,
      municipality_summary: fetchResult.municipality_summary,
      category_summary: fetchResult.category_summary
    },
    items: items
  };
  writeJson(INBOX_FILE, inbox);

  const reviewQueue = buildReviewQueueFromInbox(inbox, {
    indexPath: INDEX_FILE,
    reviewQueuePath: REVIEW_QUEUE_FILE
  });
  reviewQueue.items.forEach(function (item) {
    if (item.review_status === "PENDING") {
      item.review_status = "APPROVED";
      item.reviewed_at = new Date().toISOString();
    }
  });
  writeJson(REVIEW_QUEUE_FILE, reviewQueue);

  const applyQueue = buildApplyQueueFromReviewQueue(reviewQueue, {
    applyQueuePath: APPLY_QUEUE_FILE
  });
  writeJson(APPLY_QUEUE_FILE, applyQueue);

  const applyResult = applyDisasterSocialQueue({
    applyQueuePath: APPLY_QUEUE_FILE,
    sourcesPath: SOURCES_FILE,
    indexPath: INDEX_FILE
  });

  const result = {
    DISASTER_X_CROSS_SEARCH_PRODUCTION_SYNC: "COMPLETE",
    acquisition_mode: fetchResult.acquisition_mode,
    feed_url: fetchResult.platforms.X.feed_url,
    inbox_item_count: items.length,
    source_post_count: fetchResult.platforms.X.source_post_count,
    review_item_count: reviewQueue.item_count,
    applied_count: applyResult.applied_count,
    index_entry_count: applyResult.entry_count,
    municipality_summary: fetchResult.municipality_summary,
    category_summary: fetchResult.category_summary
  };

  console.log("=== Disaster Social Cross Search Production Sync ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("DISASTER_X_CROSS_SEARCH_PRODUCTION_SYNC_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
