#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { REGION_KYUSHU_SOUTH } = require(path.join(__dirname, "..", "monitor", "disaster-sources"));
const {
  INBOX_FILE,
  REVIEW_QUEUE_FILE,
  APPLY_QUEUE_FILE,
  AUTO_PUBLISH,
  buildReviewQueueFromInbox,
  buildApplyQueueFromReviewQueue,
  applyDisasterSocialQueue
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));
const {
  INDEX_FILE,
  SOURCES_FILE
} = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));
const { fetchDisasterSocialSnsInbox } = require(path.join(__dirname, "..", "monitor", "disaster-social-sns-fetch"));

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  const fetchResult = await fetchDisasterSocialSnsInbox();
  const inbox = {
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
    items: fetchResult.items
  };
  writeJson(INBOX_FILE, inbox);

  const emptyIndex = {
    version: "1.1",
    region: REGION_KYUSHU_SOUTH,
    description: "SNS・民間・現地発生情報インデックス",
    entries: [],
    last_updated: null
  };
  const emptyReview = {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    queue_type: "DISASTER_SOCIAL_REVIEW",
    AUTO_PUBLISH: AUTO_PUBLISH,
    item_count: 0,
    status_summary: { PENDING: 0, APPROVED: 0, REJECTED: 0, DUPLICATE: 0 },
    items: [],
    last_updated: null
  };
  const emptyApply = {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    queue_type: "DISASTER_SOCIAL_APPLY",
    AUTO_PUBLISH: AUTO_PUBLISH,
    item_count: 0,
    items: [],
    last_updated: null
  };

  writeJson(INDEX_FILE, emptyIndex);
  writeJson(REVIEW_QUEUE_FILE, emptyReview);
  writeJson(APPLY_QUEUE_FILE, emptyApply);

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

  const byPlatform = { X: 0, Instagram: 0 };
  const byCategory = {};
  const indexPayload = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  indexPayload.entries.forEach(function (entry) {
    const st = entry.source_type || "";
    if (st === "Instagram") {
      byPlatform.Instagram += 1;
    } else if (st === "X") {
      byPlatform.X += 1;
    }
    const cat = entry.category || "OTHER";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });

  console.log("=== Disaster Social Community Rebuild ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_CROSS_SEARCH_COMMUNITY_DATA_REBUILD: "COMPLETE",
        acquisition_mode: "SNS_AUTO_FETCH",
        inbox_item_count: inbox.items.length,
        review_item_count: reviewQueue.item_count,
        review_status_summary: reviewQueue.status_summary,
        applied_count: applyResult.applied_count,
        index_entry_count: applyResult.entry_count,
        platform_counts: byPlatform,
        category_summary: byCategory,
        municipality_summary: fetchResult.municipality_summary
      },
      null,
      2
    )
  );
  console.log("DISASTER_CROSS_SEARCH_COMMUNITY_DATA_REBUILD_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
