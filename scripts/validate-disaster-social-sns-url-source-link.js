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
  resolveSocialEntryUrl,
  isXPostUrl,
  isInstagramPostUrl,
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
    check: "ui post link label",
    pass: /▶ 投稿を見る/.test(appJs) && /resolveSocialPostLinkLabel/.test(appJs)
  });
  if (!/▶ 投稿を見る/.test(appJs)) {
    errors.push("app.js must show ▶ 投稿を見る for sns posts with url");
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
  const igWithUrl = igEntries.filter(function (entry) {
    return isInstagramPostUrl(resolveSocialEntryUrl(entry));
  });
  const igWithoutUrl = igEntries.filter(function (entry) {
    return !resolveSocialEntryUrl(entry);
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
    check: "Instagram url only when available",
    pass: igWithoutUrl.length > 0,
    ig_total: igEntries.length,
    ig_with_url: igWithUrl.length,
    ig_without_url: igWithoutUrl.length
  });

  const instagramResolverPass = resolveSnsPostUrlFromFeedPost(
    {
      postUrl: "https://www.instagram.com/p/ABC123xyz/",
      permalink: ""
    },
    "Instagram"
  ) === "https://www.instagram.com/p/ABC123xyz/";
  const instagramReelResolverPass = resolveSnsPostUrlFromFeedPost(
    {
      reel_url: "https://www.instagram.com/reel/XYZ987abc/"
    },
    "Instagram"
  ) === "https://www.instagram.com/reel/XYZ987abc/";
  checks.push({
    check: "Instagram real url resolver",
    pass: instagramResolverPass && instagramReelResolverPass
  });
  if (!instagramResolverPass || !instagramReelResolverPass) {
    errors.push("Instagram post/reel url resolver failed");
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
  checks.push({
    check: "X sns fetch keeps post urls",
    pass: fetchedWithUrl.length > 0,
    fetched_with_url: fetchedWithUrl.length
  });
  if (!fetchedWithUrl.length) {
    errors.push("X sns fetch must keep post urls from feed");
  }

  const inboxSns = inboxItems.filter(function (item) {
    return item.import_format === "SNS";
  });
  const inboxXWithUrl = inboxSns.filter(function (item) {
    return item.source_type === "X" && isXPostUrl(item.url);
  });
  checks.push({
    check: "inbox sns url preserved",
    pass: inboxXWithUrl.length > 0,
    inbox_sns_count: inboxSns.length,
    inbox_x_with_url: inboxXWithUrl.length
  });

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

    checks.push({
      check: "browser X post link visible",
      pass: postLinkCount > 0 && linkText === "▶ 投稿を見る" && isXPostUrl(href),
      post_link_count: postLinkCount,
      link_text: linkText,
      href: href
    });
    if (!postLinkCount || linkText !== "▶ 投稿を見る" || !isXPostUrl(href)) {
      errors.push("browser must show ▶ 投稿を見る with real X url");
    }

    await page.locator("#disaster-social-search-region").fill("霧島市");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 15000
    });
    const igCards = await page.locator("#disaster-social-search-results .disaster-search__card").count();
    const igPostLinks = await page.locator("#disaster-social-search-results .disaster-social-search__post-link").count();
    const igSourceTypes = await page.locator(".disaster-social-search__source-type").count();
    checks.push({
      check: "browser Instagram no-url hides button",
      pass: igCards > 0 && igSourceTypes > 0 && igPostLinks === 0,
      ig_cards: igCards,
      ig_post_links: igPostLinks
    });
    if (!igCards || igPostLinks > 0) {
      errors.push("Instagram entries without url must not show post link button");
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
