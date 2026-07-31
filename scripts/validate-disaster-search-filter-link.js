#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const SOCIAL_INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  resolveSocialEntryUrl,
  resolveExternalUrl,
  containsBlockedPublicUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));

const { searchDisasterSocialIndex } = require(path.join(
  ROOT,
  "monitor",
  "disaster-social-index-engine"
));

function mainStatic() {
  const errors = [];
  const checks = [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const socialPayload = JSON.parse(fs.readFileSync(SOCIAL_INDEX_FILE, "utf8"));
  const entries = socialPayload.entries || [];

  [
    { name: "date UI removed", pattern: /disaster-social-search-date/, invert: true },
    { name: "date input type removed from social search", pattern: /renderDisasterSocialSearch[\s\S]*type:\s*"date"/, invert: true },
    { name: "region search field kept", pattern: /disaster-social-search-region/ },
    { name: "category search field kept", pattern: /disaster-social-search-category/ },
    { name: "social entry url resolver", pattern: /function resolveSocialEntryUrl/ },
    { name: "external url resolver", pattern: /function resolveExternalUrl/ },
    { name: "url link uses setAttribute href", pattern: /resolveSocialEntryUrl\(item\)[\s\S]*setAttribute\("href"/ },
    { name: "url link target blank", pattern: /resolveSocialEntryUrl\(item\)[\s\S]*setAttribute\("target", "_blank"\)/ },
    { name: "url link rel noopener", pattern: /resolveSocialEntryUrl\(item\)[\s\S]*setAttribute\("rel", "noopener"\)/ },
    { name: "date display kept on cards", pattern: /disaster-social-search__date/ },
    { name: "guide text without date filter", pattern: /地域・カテゴリで検索できます/ }
  ].forEach(function (item) {
    const pass = item.invert ? !item.pattern.test(appJs) : item.pattern.test(appJs);
    checks.push({ check: item.name, pass: pass });
    if (!pass) {
      errors.push("JS check failed: " + item.name);
    }
  });

  const entriesWithDate = entries.filter(function (entry) {
    return typeof entry.date === "string" && entry.date.length > 0;
  });
  checks.push({
    check: "date data preserved",
    pass: entriesWithDate.length === entries.length && entries.length > 0,
    entry_count: entries.length,
    dated_entry_count: entriesWithDate.length
  });
  if (entriesWithDate.length !== entries.length) {
    errors.push("date field must be preserved on all social index entries");
  }

  const publicJsonText = fs.readFileSync(SOCIAL_INDEX_FILE, "utf8");
  checks.push({
    check: "public index has no example.local",
    pass: !/example\.local/i.test(publicJsonText)
  });
  if (/example\.local/i.test(publicJsonText)) {
    errors.push("public disaster_social_index.json must not contain example.local");
  }

  const blockedEntryUrls = entries.filter(function (entry) {
    const rawUrl = String(entry.url || "").trim();
    return rawUrl && !resolveSocialEntryUrl(entry);
  });
  checks.push({
    check: "public index has no blocked entry urls",
    pass: blockedEntryUrls.length === 0,
    blocked_count: blockedEntryUrls.length
  });
  if (blockedEntryUrls.length) {
    errors.push("public index contains blocked entry urls");
  }

  [
    { label: "example.local", value: "https://example.local/yatsushiro-board/water" },
    { label: "localhost", value: "http://localhost:3000/post" },
    { label: "dummy host", value: "https://dummy.support.local/post" }
  ].forEach(function (testCase) {
    const pass = resolveExternalUrl(testCase.value) === "";
    checks.push({ check: "blocked url hidden: " + testCase.label, pass: pass });
    if (!pass) {
      errors.push("blocked url must not resolve: " + testCase.label);
    }
  });

  checks.push({
    check: "public json blocked url scan",
    pass: !containsBlockedPublicUrl(socialPayload)
  });
  if (containsBlockedPublicUrl(socialPayload)) {
    errors.push("public disaster_social_index.json contains blocked urls");
  }

  const regionResults = searchDisasterSocialIndex(socialPayload, { region: "八代" });
  const categoryResults = searchDisasterSocialIndex(socialPayload, { category: "WATER" });
  const dateResults = searchDisasterSocialIndex(socialPayload, { date: "2026-07-31" });

  checks.push({
    check: "region search",
    pass: regionResults.length > 0,
    count: regionResults.length
  });
  checks.push({
    check: "category search",
    pass: categoryResults.length > 0,
    count: categoryResults.length
  });
  checks.push({
    check: "date filter engine preserved",
    pass: dateResults.length > 0,
    count: dateResults.length
  });

  if (!regionResults.length) {
    errors.push("region search failed");
  }
  if (!categoryResults.length) {
    errors.push("category search failed");
  }
  if (!dateResults.length) {
    errors.push("date filter engine check failed");
  }

  return { checks: checks, errors: errors };
}

async function mainBrowser(entries) {
  const errors = [];
  const checks = [];
  const withUrlEntry = entries.find(function (entry) {
    return Boolean(resolveSocialEntryUrl(entry));
  });
  const withoutUrlEntry = entries.find(function (entry) {
    return !resolveSocialEntryUrl(entry);
  });

  if (!withoutUrlEntry) {
    errors.push("unable to pick entry without publishable url for browser validation");
    return { checks: checks, errors: errors };
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search").scrollIntoViewIfNeeded();

    const dateInputCount = await page.locator("#disaster-social-search-date").count();
    checks.push({
      check: "date UI removed in browser",
      pass: dateInputCount === 0,
      date_input_count: dateInputCount
    });
    if (dateInputCount !== 0) {
      errors.push("date input still rendered in browser");
    }

    const regionMunicipality = (withUrlEntry || withoutUrlEntry).municipality || "八代市";
    await page.locator("#disaster-social-search-region").fill(regionMunicipality);
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 10000
    });
    const regionCardCount = await page.locator("#disaster-social-search-results .disaster-search__card").count();
    const regionLinkHrefs = await page
      .locator("#disaster-social-search-results .disaster-search__official-link")
      .evaluateAll(function (nodes) {
        return nodes.map(function (node) {
          return node.getAttribute("href") || "";
        });
      });
    const hasDummyHref = regionLinkHrefs.some(function (href) {
      return /example\.local|localhost|dummy|\/example\//i.test(href);
    });
    checks.push({
      check: "region search browser",
      pass: regionCardCount > 0,
      card_count: regionCardCount,
      municipality: regionMunicipality,
      link_count: regionLinkHrefs.length
    });
    checks.push({
      check: "no dummy href in region results",
      pass: !hasDummyHref,
      hrefs: regionLinkHrefs
    });
    if (!regionCardCount) {
      errors.push("region search returned no cards in browser");
    }
    if (hasDummyHref) {
      errors.push("region search results contain blocked dummy hrefs");
    }

    if (withUrlEntry) {
      const expectedUrl = resolveSocialEntryUrl(withUrlEntry);
      const withUrlCard = page
        .locator("#disaster-social-search-results .disaster-search__card")
        .filter({ hasText: withUrlEntry.title });
      const withUrlCardCount = await withUrlCard.count();
      const link = withUrlCard.locator(".disaster-search__official-link");
      const linkCount = withUrlCardCount ? await link.count() : 0;
      const href = linkCount ? await link.getAttribute("href") : "";
      checks.push({
        check: "registered url link present with href",
        pass: withUrlCardCount > 0 && linkCount === 1 && href === expectedUrl,
        entry_id: withUrlEntry.id,
        expected_href: expectedUrl,
        actual_href: href || ""
      });
      if (!withUrlCardCount || linkCount !== 1 || href !== expectedUrl) {
        errors.push("registered url link missing for " + withUrlEntry.id);
      }
    } else {
      checks.push({
        check: "registered url link present with href",
        pass: regionLinkHrefs.length === 0,
        note: "no publishable entry urls in public index"
      });
    }

    await page.locator("#disaster-social-search-region").fill("");
    await page.locator("#disaster-social-search-category").fill("給水");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 10000
    });
    const categoryCardCount = await page.locator("#disaster-social-search-results .disaster-search__card").count();
    checks.push({
      check: "category search browser",
      pass: categoryCardCount > 0,
      card_count: categoryCardCount
    });
    if (!categoryCardCount) {
      errors.push("category search returned no cards in browser");
    }

    await page.locator("#disaster-social-search-region").fill(withoutUrlEntry.municipality || "");
    await page.locator("#disaster-social-search-category").fill("");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 10000
    });
    const noUrlCard = page
      .locator("#disaster-social-search-results .disaster-search__card")
      .filter({ hasText: withoutUrlEntry.title });
    const noUrlCardCount = await noUrlCard.count();
    const noUrlLinkCount = noUrlCardCount
      ? await noUrlCard.locator(".disaster-search__official-link").count()
      : 0;
    checks.push({
      check: "url button hidden when url missing",
      pass: noUrlCardCount > 0 && noUrlLinkCount === 0,
      entry_id: withoutUrlEntry.id,
      registered_url: withoutUrlEntry.url || "",
      card_count: noUrlCardCount,
      link_count: noUrlLinkCount
    });
    if (!noUrlCardCount || noUrlLinkCount !== 0) {
      errors.push("url button must be hidden for entries without url: " + withoutUrlEntry.id);
    }
  } finally {
    await browser.close();
  }

  return { checks: checks, errors: errors };
}

async function main() {
  const socialPayload = JSON.parse(fs.readFileSync(SOCIAL_INDEX_FILE, "utf8"));
  const entries = socialPayload.entries || [];
  const staticResult = mainStatic();
  const errors = staticResult.errors.slice();
  const checks = staticResult.checks.slice();

  try {
    const browserResult = await mainBrowser(entries);
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
    DISASTER_SEARCH_EXTERNAL_URL_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    serve_url: SERVE_URL,
    checks: checks,
    errors: errors
  };

  console.log("=== Disaster Search Filter Link Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SEARCH_EXTERNAL_URL_FIX_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
