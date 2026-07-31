#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const INDEX_FILE = path.join(ROOT, "data", "community", "disaster_social_index.json");
const INBOX_FILE = path.join(ROOT, "data", "community", "disaster_social_inbox.json");
const PUBLIC_INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  SNS_FETCH_PLATFORMS
} = require(path.join(ROOT, "monitor", "disaster-social-community-scope"));
const {
  resolveSocialEntryUrl,
  isXPostUrl,
  resolveSnsPostUrlFromFeedPost,
  containsBlockedPublicUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));
const { fetchXInboxItems } = require(path.join(ROOT, "monitor", "disaster-social-sns-fetch"));

function fetchJson(url) {
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
  const errors = [];
  const checks = [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const indexPayload = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const inboxPayload = JSON.parse(fs.readFileSync(INBOX_FILE, "utf8"));
  const entries = indexPayload.entries || [];
  const inboxItems = inboxPayload.items || [];

  checks.push({
    check: "sns fetch platforms x only",
    pass: SNS_FETCH_PLATFORMS.length === 1 && SNS_FETCH_PLATFORMS[0] === "X",
    platforms: SNS_FETCH_PLATFORMS
  });
  if (SNS_FETCH_PLATFORMS.join(",") !== "X") {
    errors.push("SNS_FETCH_PLATFORMS must be X only");
  }

  checks.push({
    check: "ui post link label",
    pass: /▶ 投稿を見る/.test(appJs) && /resolveSocialPostLinkLabel/.test(appJs)
  });
  if (!/▶ 投稿を見る/.test(appJs)) {
    errors.push("app.js must show ▶ 投稿を見る for X posts with url");
  }

  checks.push({
    check: "instagram fetch removed from app",
    pass: !/Instagram/.test(appJs) || !/sourceType === "Instagram"/.test(appJs)
  });
  if (/sourceType === "Instagram"/.test(appJs)) {
    errors.push("app.js must not reference Instagram sns post links");
  }

  const xEntries = entries.filter(function (entry) {
    return entry.source_type === "X";
  });
  const igEntries = entries.filter(function (entry) {
    return entry.source_type === "Instagram";
  });
  const xWithUrl = xEntries.filter(function (entry) {
    return isXPostUrl(resolveSocialEntryUrl(entry));
  });

  checks.push({
    check: "X post real url display data",
    pass: xWithUrl.length > 0 && xWithUrl.length === xEntries.filter(function (e) { return e.url; }).length,
    x_total: xEntries.length,
    x_with_url: xWithUrl.length
  });
  if (!xWithUrl.length) {
    errors.push("X entries must retain real post urls");
  }

  checks.push({
    check: "Instagram entries excluded from index",
    pass: igEntries.length === 0,
    ig_total: igEntries.length
  });
  if (igEntries.length) {
    errors.push("community index must not contain Instagram entries");
  }

  const feedPayload = await fetchJson(
    "https://raw.githubusercontent.com/toropoo-web/kumamoto-disaster-x-feed/main/data/posts.json"
  );
  const feedPosts = Array.isArray(feedPayload) ? feedPayload : feedPayload.posts || [];
  const feedPost = feedPosts.find(function (post) {
    return post.postUrl && isXPostUrl(post.postUrl);
  });
  const feedUrlResolved = feedPost ? resolveSnsPostUrlFromFeedPost(feedPost, "X") : "";
  checks.push({
    check: "X feed postUrl preserved",
    pass: Boolean(feedPost && feedUrlResolved === feedPost.postUrl),
    sample_post_url: feedUrlResolved
  });
  if (!feedPost || feedUrlResolved !== feedPost.postUrl) {
    errors.push("X feed postUrl must be preserved without guessing");
  }

  const xFetch = await fetchXInboxItems();
  const fetchedWithUrl = (xFetch.items || []).filter(function (item) {
    return isXPostUrl(item.url);
  });
  const fetchedInstagram = (xFetch.items || []).filter(function (item) {
    return item.source_type === "Instagram";
  });
  checks.push({
    check: "X sns fetch keeps post urls",
    pass: fetchedWithUrl.length > 0 && fetchedInstagram.length === 0,
    fetched_with_url: fetchedWithUrl.length,
    fetched_instagram_count: fetchedInstagram.length
  });
  if (!fetchedWithUrl.length || fetchedInstagram.length) {
    errors.push("X sns fetch must keep post urls and exclude Instagram");
  }

  const inboxSns = inboxItems.filter(function (item) {
    return item.import_format === "SNS";
  });
  const inboxXWithUrl = inboxSns.filter(function (item) {
    return item.source_type === "X" && isXPostUrl(item.url);
  });
  const inboxInstagram = inboxSns.filter(function (item) {
    return item.source_type === "Instagram";
  });
  checks.push({
    check: "inbox sns url preserved",
    pass: inboxXWithUrl.length > 0 && inboxInstagram.length === 0,
    inbox_sns_count: inboxSns.length,
    inbox_x_with_url: inboxXWithUrl.length,
    inbox_instagram_count: inboxInstagram.length
  });
  if (inboxInstagram.length) {
    errors.push("production inbox must not contain Instagram sns items");
  }

  checks.push({
    check: "dummy url count zero",
    pass:
      !containsBlockedPublicUrl(indexPayload) &&
      !containsBlockedPublicUrl(inboxPayload) &&
      !/example\.local/i.test(fs.readFileSync(PUBLIC_INDEX_FILE, "utf8"))
  });
  if (containsBlockedPublicUrl(indexPayload) || containsBlockedPublicUrl(inboxPayload)) {
    errors.push("dummy or blocked urls found in community data");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search-region").fill("八代市");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 15000
    });

    const postLink = page.locator("#disaster-social-search-results .disaster-social-search__post-link").first();
    const postLinkCount = await page.locator("#disaster-social-search-results .disaster-social-search__post-link").count();
    const linkText = postLinkCount ? await postLink.innerText() : "";
    const href = postLinkCount ? await postLink.getAttribute("href") : "";
    const sourceTypeText = await page.locator(".disaster-social-search__source-type").first().innerText();

    checks.push({
      check: "browser X post link visible",
      pass:
        postLinkCount > 0 &&
        linkText === "▶ 投稿を見る" &&
        isXPostUrl(href) &&
        sourceTypeText === "情報元：X",
      post_link_count: postLinkCount,
      link_text: linkText,
      href: href,
      source_type_text: sourceTypeText
    });
    if (!postLinkCount || linkText !== "▶ 投稿を見る" || !isXPostUrl(href) || sourceTypeText !== "情報元：X") {
      errors.push("browser must show 情報元：X and ▶ 投稿を見る with real X url");
    }
  } finally {
    await browser.close();
  }

  console.log("=== Disaster Social SNS URL Source Link Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_SNS_URL_SOURCE_LINK_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        checks: checks,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SOCIAL_SNS_URL_SOURCE_LINK_IMPLEMENT_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
