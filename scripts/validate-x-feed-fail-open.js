#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { syncXFeed } = require("./sync-x-feed");

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function writeFixturePreview(filePath) {
  const payload = {
    section_title: "公式X速報",
    synced_at: "2026-07-30T00:00:00.000Z",
    source_feed_url: "https://example.test/posts.json",
    item_count: 2,
    posts: [
      {
        source_id: "SRC-NAT-001",
        account_name: "首相官邸",
        account_handle: "kantei_saigai",
        post_time: "2026-07-30T00:00:00.000Z",
        text: "fixture post one",
        url: "https://x.com/example/status/1",
        source_type: "GOVERNMENT"
      },
      {
        source_id: "SRC-KUM-001",
        account_name: "熊本県",
        account_handle: "pref_kumamoto",
        post_time: "2026-07-29T23:00:00.000Z",
        text: "fixture post two",
        url: "https://x.com/example/status/2",
        source_type: "PREFECTURE"
      }
    ]
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function runCase(name, fn) {
  const errors = [];
  try {
    await fn(errors);
  } catch (err) {
    errors.push(name + ": unexpected exception (" + err.message + ")");
  }
  return { name: name, pass: errors.length === 0, errors: errors };
}

async function main() {
  const cases = [];

  cases.push(await runCase("retain_stale_preview_on_fetch_failure", async function (errors) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-feed-fail-open-"));
    const outputPath = path.join(tempDir, "x_feed_preview.json");
    writeFixturePreview(outputPath);

    const result = await syncXFeed({
      outputPath: outputPath,
      postsUrl: "https://invalid.example.test/posts.json",
      failOpen: true
    });

    assert(result.X_FEED_SYNC === "FAIL_OPEN", "expected FAIL_OPEN status", errors);
    assert(result.selectedCount === 2, "expected retained post count 2", errors);

    const saved = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert(saved.sync_status === "STALE", "expected sync_status STALE", errors);
    assert(saved.sync_error, "expected sync_error to be set", errors);
    assert(saved.last_successful_sync_at === "2026-07-30T00:00:00.000Z", "expected last_successful_sync_at preserved", errors);
    assert(saved.posts.length === 2, "expected posts retained", errors);
  }));

  cases.push(await runCase("strict_mode_fails_without_existing_preview", async function (errors) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-feed-fail-open-"));
    const outputPath = path.join(tempDir, "missing-preview.json");
    let threw = false;

    try {
      await syncXFeed({
        outputPath: outputPath,
        postsUrl: "https://invalid.example.test/posts.json",
        failOpen: false
      });
    } catch (err) {
      threw = true;
      assert(/HTTP|ENOTFOUND|getaddrinfo/i.test(err.message), "expected fetch failure error", errors);
    }

    assert(threw, "expected strict sync to throw without existing preview", errors);
    assert(!fs.existsSync(outputPath), "expected no preview file on strict failure", errors);
  }));

  cases.push(await runCase("fresh_sync_from_fixture_posts", async function (errors) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-feed-fail-open-"));
    const outputPath = path.join(tempDir, "fresh-preview.json");
    const postsFile = path.join(tempDir, "posts.json");
    const posts = [];

    for (let index = 0; index < 6; index += 1) {
      posts.push({
        sourceId: "SRC-NAT-00" + ((index % 6) + 1),
        sourceName: "首相官邸",
        accountHandle: "kantei_saigai",
        postedAt: "2026-07-3" + index + "T10:00:00.000Z",
        postUrl: "https://x.com/example/status/" + (index + 10),
        summary: "fixture upstream post " + index,
        status: "ACTIVE"
      });
    }

    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2) + "\n", "utf8");

    const result = await syncXFeed({
      outputPath: outputPath,
      postsFile: postsFile,
      failOpen: true
    });

    assert(result.X_FEED_SYNC === "PASS", "expected PASS status", errors);
    assert(result.selectedCount > 0, "expected selected posts", errors);

    const saved = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert(saved.sync_status === "FRESH", "expected sync_status FRESH", errors);
    assert(!saved.sync_error, "expected no sync_error on fresh sync", errors);
  }));

  const failures = cases.filter(function (item) {
    return !item.pass;
  });

  const output = {
    X_FEED_FAIL_OPEN_VALIDATION: failures.length === 0 ? "PASS" : "FAIL",
    cases: cases,
    failureCount: failures.length
  };

  console.log("=== X Feed Fail-Open Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
