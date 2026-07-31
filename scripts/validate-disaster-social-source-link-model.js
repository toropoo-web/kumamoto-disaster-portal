#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");
const SOURCES_FILE = path.join(ROOT, "data", "public", "disaster_social_sources.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  resolveSocialEntryUrl,
  containsBlockedPublicUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));
const {
  resolveSocialSourceTypeLabel,
  buildSocialSourceLookupFromPayload
} = require(path.join(ROOT, "monitor", "disaster-social-source-display"));

function mainStatic() {
  const errors = [];
  const checks = [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const indexPayload = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const sourcesPayload = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  const entries = indexPayload.entries || [];
  const sourceLookup = buildSocialSourceLookupFromPayload(sourcesPayload);

  [
    { name: "source type labels", pattern: /SOCIAL_SOURCE_TYPE_LABELS/ },
    { name: "append social source display", pattern: /function appendSocialSourceDisplay/ },
    { name: "post link label", pattern: /▶ 投稿を見る/ },
    { name: "sns post link resolver", pattern: /resolveSocialPostLinkLabel/ },
    { name: "source type always shown", pattern: /disaster-social-search__source-type[\s\S]*投稿を見る/ },
    { name: "removed 情報元を見る label", pattern: /情報元を見る/, invert: true },
    { name: "removed URLを開く label", pattern: /URLを開く/, invert: true },
    { name: "sources use source_url field", pattern: /source_url/ }
  ].forEach(function (item) {
    const pass = item.invert ? !item.pattern.test(appJs) : item.pattern.test(appJs);
    checks.push({ check: item.name, pass: pass });
    if (!pass) {
      errors.push("app.js check failed: " + item.name);
    }
  });

  const requiredFields = ["source", "source_type", "captured_at", "url"];
  const missingFieldEntries = entries.filter(function (entry) {
    return requiredFields.some(function (field) {
      return typeof entry[field] !== "string";
    });
  });
  checks.push({
    check: "index entries keep source fields",
    pass: missingFieldEntries.length === 0,
    entry_count: entries.length,
    missing_count: missingFieldEntries.length
  });
  if (missingFieldEntries.length) {
    errors.push("index entries missing required source fields");
  }

  checks.push({
    check: "dummy url count zero",
    pass: !containsBlockedPublicUrl(indexPayload) && !/example\.local/i.test(fs.readFileSync(INDEX_FILE, "utf8")),
    entry_count: entries.length
  });
  if (containsBlockedPublicUrl(indexPayload)) {
    errors.push("public index contains blocked urls");
  }

  const sourcesWithSourceUrl = (sourcesPayload.sources || []).filter(function (source) {
    return typeof source.source_url === "string";
  });
  checks.push({
    check: "sources define source_url",
    pass: sourcesWithSourceUrl.length === (sourcesPayload.sources || []).length,
    source_count: (sourcesPayload.sources || []).length
  });

  const syntheticWithUrl = {
    source: "SOC-LOCAL-001",
    source_type: "X",
    url: "https://x.com/"
  };
  const syntheticWithoutUrl = {
    source: "SOC-LOCAL-002",
    source_type: "WEB",
    url: ""
  };
  checks.push({
    check: "url present resolves for link display",
    pass: resolveSocialEntryUrl(syntheticWithUrl) === "https://x.com/",
    resolved: resolveSocialEntryUrl(syntheticWithUrl)
  });
  checks.push({
    check: "url absent does not resolve",
    pass: !resolveSocialEntryUrl(syntheticWithoutUrl),
    label: resolveSocialSourceTypeLabel(syntheticWithoutUrl, sourceLookup[syntheticWithoutUrl.source])
  });
  if (!resolveSocialEntryUrl(syntheticWithUrl)) {
    errors.push("publishable entry url must resolve");
  }
  if (resolveSocialEntryUrl(syntheticWithoutUrl)) {
    errors.push("empty entry url must not resolve");
  }

  const { isXPostUrl } = require(path.join(ROOT, "monitor", "disaster-social-url"));

  checks.push({
    check: "sns rebuild entry volume",
    pass: entries.length >= 100,
    entry_count: entries.length
  });
  if (entries.length < 100) {
    errors.push("community layer entry count too low after sns rebuild");
  }

  const xWithUrl = entries.filter(function (entry) {
    return entry.source_type === "X" && isXPostUrl(resolveSocialEntryUrl(entry));
  });
  checks.push({
    check: "X entries keep post urls",
    pass: xWithUrl.length > 0,
    x_with_url: xWithUrl.length
  });
  if (!xWithUrl.length) {
    errors.push("X entries must keep real post urls");
  }

  const igWithoutUrl = entries.filter(function (entry) {
    return entry.source_type === "Instagram";
  });
  checks.push({
    check: "Instagram entries excluded from index",
    pass: igWithoutUrl.length === 0,
    ig_count: igWithoutUrl.length
  });
  if (igWithoutUrl.length) {
    errors.push("community index must not contain Instagram entries");
  }

  return { checks: checks, errors: errors, entries: entries, sourceLookup: sourceLookup };
}

async function mainBrowser(entries, sourceLookup) {
  const errors = [];
  const checks = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search").scrollIntoViewIfNeeded();

    await page.locator("#disaster-social-search-region").fill("八代市");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 15000
    });
    const sourceTypeCount = await page.locator(".disaster-social-search__source-type").count();
    const postLinkCount = await page.locator("#disaster-social-search-results .disaster-social-search__post-link").count();
    const sourceTypeText = sourceTypeCount
      ? await page.locator(".disaster-social-search__source-type").first().innerText()
      : "";
    const firstPostLinkText = postLinkCount
      ? await page.locator("#disaster-social-search-results .disaster-social-search__post-link").first().innerText()
      : "";

    checks.push({
      check: "sns search shows source type",
      pass: sourceTypeCount > 0 && /情報元：/.test(sourceTypeText),
      source_type_count: sourceTypeCount,
      sample_text: sourceTypeText
    });
    checks.push({
      check: "sns search shows post link",
      pass: postLinkCount > 0 && firstPostLinkText === "▶ 投稿を見る",
      post_link_count: postLinkCount,
      link_text: firstPostLinkText
    });

    if (!sourceTypeCount || !/情報元：/.test(sourceTypeText)) {
      errors.push("sns source type display failed");
    }
    if (!postLinkCount || firstPostLinkText !== "▶ 投稿を見る") {
      errors.push("sns post link display failed");
    }

    const withUrlEntry = entries.find(function (entry) {
      return Boolean(resolveSocialEntryUrl(entry));
    });
    if (withUrlEntry) {
      await page.locator("#disaster-social-search-region").fill(withUrlEntry.municipality || "");
      await page.locator("#disaster-social-search-category").fill("");
      await page.locator(".disaster-social-search__form button[type='submit']").click();
      await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
        timeout: 10000
      });
      const card = page
        .locator("#disaster-social-search-results .disaster-search__card")
        .filter({ hasText: withUrlEntry.title });
      const sourceTypeOnCard = await card.locator(".disaster-social-search__source-type").count();
      const link = card.locator(".disaster-social-search__post-link");
      const linkText = await link.innerText();
      const href = await link.getAttribute("href");
      const expectedLabel = withUrlEntry.source_type === "X" ? "▶ 投稿を見る" : "情報を見る";
      checks.push({
        check: "url present shows source and post link",
        pass:
          sourceTypeOnCard === 1 &&
          linkText === expectedLabel &&
          href === resolveSocialEntryUrl(withUrlEntry),
        entry_id: withUrlEntry.id,
        href: href || ""
      });
      if (sourceTypeOnCard !== 1 || linkText !== expectedLabel || href !== resolveSocialEntryUrl(withUrlEntry)) {
        errors.push("url present link display failed");
      }
    } else {
      checks.push({
        check: "url present shows source and post link",
        pass: true,
        note: "skipped: no publishable entry urls in public index"
      });
    }
  } finally {
    await browser.close();
  }

  return { checks: checks, errors: errors };
}

async function main() {
  const staticResult = mainStatic();
  const errors = staticResult.errors.slice();
  const checks = staticResult.checks.slice();

  try {
    const browserResult = await mainBrowser(staticResult.entries, staticResult.sourceLookup);
    checks.push.apply(
      checks,
      browserResult.checks.map(function (item) {
        return Object.assign({}, item, { scope: "browser" });
      })
    );
    errors.push.apply(errors, browserResult.errors);
  } catch (err) {
    errors.push("browser validation failed: " + err.message);
  }

  const output = {
    DISASTER_SEARCH_EXTERNAL_SOURCE_LINK_MODEL_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    serve_url: SERVE_URL,
    checks: checks,
    errors: errors
  };

  console.log("=== Disaster Social Source Link Model Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SEARCH_EXTERNAL_SOURCE_LINK_MODEL_UPDATE_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
