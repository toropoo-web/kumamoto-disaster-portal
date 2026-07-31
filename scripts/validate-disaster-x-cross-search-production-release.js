#!/usr/bin/env node
"use strict";

const https = require("https");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const { searchDisasterSocialIndex } = require("../monitor/disaster-social-index-engine");
const {
  buildEntryContentHaystack,
  matchesPreciseSearchQuery
} = require("../monitor/disaster-social-search-match");
const { isXPostUrl } = require("../monitor/disaster-social-url");

const PROD = process.env.PRODUCTION_URL || "https://kumamoto-disaster-portal.onrender.com";

const EXPECTED = {
  social_index_count: 366,
  給水: 118,
  支援物資: 41,
  炊き出し: 3,
  風呂: 3,
  氷: 13,
  official_water: 43,
  official_volunteer: 20
};

function fetchJson(url) {
  return new Promise(function (resolve, reject) {
    https
      .get(url, function (res) {
        let data = "";
        res.on("data", function (chunk) {
          data += chunk;
        });
        res.on("end", function () {
          if (res.statusCode !== 200) {
            reject(new Error(url + " HTTP " + res.statusCode));
            return;
          }
          resolve(JSON.parse(data));
        });
      })
      .on("error", reject);
  });
}

function isPetFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  if (/ペットボトル/.test(hay) && !matchesPreciseSearchQuery(hay, "ペット")) {
    return true;
  }
  if (/警備犬|救助犬/.test(hay) && !/迷子犬|迷い犬|犬を探|犬が迷|保護犬/.test(hay)) {
    return true;
  }
  return false;
}

function isLostFalsePositive(entry) {
  return isPetFalsePositive(entry);
}

function isIceTownFalsePositive(entry) {
  const hay = buildEntryContentHaystack(entry);
  if (!/氷川[町村]?/.test(hay)) {
    return false;
  }
  const stripped = hay.replace(/氷川[町村]?/g, "");
  return /氷/.test(hay) && !/氷/.test(stripped) && !matchesPreciseSearchQuery(hay, "氷");
}

function countOfficialCategory(index, category) {
  return (index.items || index.entries || []).filter(function (item) {
    return item.category === category;
  }).length;
}

async function main() {
  const errors = [];
  const checks = [];
  let commit = "";

  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch (err) {
    commit = "unknown";
  }

  const socialIndex = await fetchJson(PROD + "/data/public/disaster_social_index.json");
  const officialIndex = await fetchJson(PROD + "/data/public/disaster_search_index.json");
  const entries = socialIndex.entries || [];

  checks.push({
    check: "disaster_social_index.json 366件",
    pass: entries.length === EXPECTED.social_index_count,
    count: entries.length
  });
  if (entries.length !== EXPECTED.social_index_count) {
    errors.push("social index count must be 366");
  }

  const badUrl = entries.filter(function (entry) {
    return !isXPostUrl(entry.url || entry.post_url || "");
  });
  checks.push({
    check: "X URL全件",
    pass: badUrl.length === 0,
    invalid: badUrl.length
  });
  if (badUrl.length) {
    errors.push("non-X URLs found: " + badUrl.length);
  }

  const searchCounts = {};
  ["給水", "支援物資", "炊き出し", "風呂", "氷", "ペット", "迷子"].forEach(function (query) {
    const results = searchDisasterSocialIndex(socialIndex, { categoryQuery: query });
    searchCounts[query] = results.length;
    let pass = true;
    if (Object.prototype.hasOwnProperty.call(EXPECTED, query)) {
      pass = results.length === EXPECTED[query];
    } else if (query === "ペット" || query === "迷子") {
      const falsePositives = results.filter(function (item) {
        return query === "ペット" ? isPetFalsePositive(item.entry) : isLostFalsePositive(item.entry);
      });
      pass = falsePositives.length === 0;
      if (falsePositives.length) {
        errors.push(query + " false positives: " + falsePositives.length);
      }
    }
    checks.push({
      check: "search " + query,
      pass: pass,
      count: results.length,
      expected: EXPECTED[query]
    });
    if (!pass && Object.prototype.hasOwnProperty.call(EXPECTED, query)) {
      errors.push(query + " expected " + EXPECTED[query] + " got " + results.length);
    }
  });

  const petBottleHits = searchDisasterSocialIndex(socialIndex, { categoryQuery: "ペット" }).filter(
    function (item) {
      return /ペットボトル/.test(buildEntryContentHaystack(item.entry));
    }
  );
  checks.push({
    check: "ペットボトル除外",
    pass: petBottleHits.length === 0,
    count: petBottleHits.length
  });
  if (petBottleHits.length) {
    errors.push("ペットボトル false hits: " + petBottleHits.length);
  }

  const iceTownHits = searchDisasterSocialIndex(socialIndex, { categoryQuery: "氷" }).filter(
    function (item) {
      return isIceTownFalsePositive(item.entry);
    }
  );
  checks.push({
    check: "氷川町除外",
    pass: iceTownHits.length === 0,
    count: iceTownHits.length
  });
  if (iceTownHits.length) {
    errors.push("氷川町 false hits: " + iceTownHits.length);
  }

  const waterCount = countOfficialCategory(officialIndex, "WATER");
  const volunteerCount = countOfficialCategory(officialIndex, "VOLUNTEER");
  checks.push({
    check: "official WATER 43件",
    pass: waterCount === EXPECTED.official_water,
    count: waterCount
  });
  checks.push({
    check: "official VOLUNTEER 20件",
    pass: volunteerCount === EXPECTED.official_volunteer,
    count: volunteerCount
  });
  if (waterCount !== EXPECTED.official_water) {
    errors.push("official WATER expected 43 got " + waterCount);
  }
  if (volunteerCount !== EXPECTED.official_volunteer) {
    errors.push("official VOLUNTEER expected 20 got " + volunteerCount);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(PROD, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search-category").fill("給水");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 30000
    });
    const cardCount = await page
      .locator("#disaster-social-search-results .disaster-search__card")
      .count();
    checks.push({
      check: "browser 給水 search",
      pass: cardCount === EXPECTED.給水,
      count: cardCount
    });
    if (cardCount !== EXPECTED.給水) {
      errors.push("browser 給水 expected " + EXPECTED.給水 + " got " + cardCount);
    }
  } finally {
    await browser.close();
  }

  const result = {
    PHASE_RESULT:
      errors.length === 0
        ? "DISASTER_X_CROSS_SEARCH_DICTIONARY_PRODUCTION_RELEASE_COMPLETE"
        : "FAIL",
    commit: commit,
    production_url: PROD,
    index_count: entries.length,
    search_counts: searchCounts,
    official_counts: {
      WATER: waterCount,
      VOLUNTEER: volunteerCount
    },
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
