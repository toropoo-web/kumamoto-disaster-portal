#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  DEFAULT_INSTAGRAM_FEED_URL,
  DEFAULT_INSTAGRAM_FEED_FILE,
  INSTAGRAM_FIXTURE_FILE,
  fetchInstagramInboxItems
} = require(path.join(__dirname, "..", "monitor", "disaster-social-sns-fetch"));

function fetchJson(url) {
  const https = require("https");
  return new Promise(function (resolve, reject) {
    https
      .get(url, function (response) {
        if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode));
          response.resume();
          return;
        }
        let data = "";
        response.on("data", function (chunk) {
          data += chunk;
        });
        response.on("end", function () {
          resolve(JSON.parse(data));
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const feedUrl = process.env.DISASTER_SOCIAL_INSTAGRAM_FEED_URL || DEFAULT_INSTAGRAM_FEED_URL;
  const outputPath = path.join(ROOT, "data", "community", "disaster_social_instagram_feed.json");
  let payload = null;
  let source = feedUrl;
  let sourceType = "remote";

  try {
    payload = await fetchJson(feedUrl);
  } catch (err) {
    payload = JSON.parse(fs.readFileSync(INSTAGRAM_FIXTURE_FILE, "utf8"));
    source = INSTAGRAM_FIXTURE_FILE;
    sourceType = "fixture";
    console.warn("INSTAGRAM_FEED_FALLBACK=" + err.message);
  }

  const posts = Array.isArray(payload) ? payload : payload.posts || payload.items || [];
  const output = {
    version: "1.0",
    synced_at: new Date().toISOString(),
    source: source,
    source_type: sourceType,
    feed_url: feedUrl,
    item_count: posts.length,
    posts: posts
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  const preview = await fetchInstagramInboxItems({
    instagramFeedPath: outputPath
  });
  console.log("=== Disaster Social Instagram Feed Sync ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_INSTAGRAM_FEED_SYNC: "COMPLETE",
        output_path: outputPath,
        source_type: sourceType,
        source_post_count: preview.source_post_count,
        inbox_item_count: preview.inbox_item_count
      },
      null,
      2
    )
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
