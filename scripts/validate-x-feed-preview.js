#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PREVIEW_FILE = path.join(ROOT, "data", "public", "x_feed_preview.json");

function isValidUrlFormat(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateXFeedPreview(errors) {
  if (!fs.existsSync(PREVIEW_FILE)) {
    errors.push("x_feed_preview.json: file missing");
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(PREVIEW_FILE, "utf8"));
  } catch (err) {
    errors.push("x_feed_preview.json: invalid JSON (" + err.message + ")");
    return;
  }

  if (!data.synced_at) {
    errors.push("x_feed_preview.json: synced_at missing");
  }

  if (!data.posts || !Array.isArray(data.posts)) {
    errors.push("x_feed_preview.json: posts array missing");
    return;
  }

  if (data.posts.length < 1 || data.posts.length > 8) {
    errors.push("x_feed_preview.json: post count " + data.posts.length + " (expected 1-8)");
  }

  const seenUrls = new Set();
  data.posts.forEach(function (post, index) {
    const label = "x_feed_preview.json[" + index + "]";

    ["source_id", "account_name", "post_time", "text", "url"].forEach(function (field) {
      if (!post[field] || String(post[field]).trim() === "") {
        errors.push(label + ": missing " + field);
      }
    });

    if (post.url && !isValidUrlFormat(post.url)) {
      errors.push(label + ": invalid url");
    }

    if (post.url) {
      if (seenUrls.has(post.url)) {
        errors.push(label + ": duplicate url");
      }
      seenUrls.add(post.url);
    }

    if (post.source_id === "SRC-PER-001" || post.account_name === "小泉進次郎") {
      errors.push(label + ": personal source SRC-PER-001 must not appear in portal preview");
    }
  });
}

function main() {
  const errors = [];
  validateXFeedPreview(errors);

  const payload = fs.existsSync(PREVIEW_FILE)
    ? JSON.parse(fs.readFileSync(PREVIEW_FILE, "utf8"))
    : null;

  const output = {
    X_FEED_PREVIEW_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    synced_at: payload ? payload.synced_at : null,
    item_count: payload && payload.posts ? payload.posts.length : 0,
    errors: errors
  };

  console.log("=== X Feed Preview Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("X_FEED_PREVIEW_VALIDATION_COMPLETE");
}

main();
