#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  OUTPUT_FILE,
  REGION_KYUSHU_SOUTH,
  CATEGORIES,
  OPENING_TYPE_VALUES,
  PROVIDER_TYPE_VALUES,
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex,
  validateDisasterSearchIndex,
  validateVolunteerIndexExample,
  validateSupportServiceIndexExample
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const errors = [];
  const checks = [];

  [
    "data/disaster_sources.json",
    "data/water_cross_view.json",
    "monitor/disaster-search-index-engine.js",
    "scripts/build-disaster-search-index.js"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const payload = buildAndWriteDisasterSearchIndex();
  errors.push.apply(errors, validateDisasterSearchIndex(payload));
  checks.push({
    check: "JSON valid",
    pass: payload.version === "1.0" && Array.isArray(payload.index)
  });

  checks.push({
    check: "region valid",
    pass: payload.region === REGION_KYUSHU_SOUTH,
    region: payload.region
  });

  const categories = {};
  payload.index.forEach(function (entry) {
    categories[entry.category] = (categories[entry.category] || 0) + 1;
  });
  checks.push({
    check: "category valid",
    pass: Object.keys(categories).every(function (name) {
      return CATEGORIES.indexOf(name) !== -1;
    }),
    categories: categories
  });

  const officialOnly = payload.index.every(function (entry) {
    return entry.official === true;
  });
  checks.push({ check: "official=true only", pass: officialOnly });
  if (!officialOnly) {
    errors.push("index entries must all have official=true");
  }

  const sourceUrlPresent = payload.index.every(function (entry) {
    return Boolean(entry.source_url);
  });
  checks.push({ check: "source_url exists", pass: sourceUrlPresent });
  if (!sourceUrlPresent) {
    errors.push("index entries must include source_url");
  }

  const ids = payload.index.map(function (entry) {
    return entry.index_id;
  });
  const uniqueIds = new Set(ids);
  checks.push({
    check: "duplicate index_id none",
    pass: ids.length === uniqueIds.size
  });
  if (ids.length !== uniqueIds.size) {
    errors.push("duplicate index_id detected");
  }

  const kumamotoResults = searchDisasterIndex(payload, "熊本 給水", { category: "WATER" });
  const kagoshimaResults = searchDisasterIndex(payload, "霧島 給水", { category: "WATER" });
  const ukiResults = searchDisasterIndex(payload, "宇城 給水", { category: "WATER" });
  const waterOnly = searchDisasterIndex(payload, "給水", { category: "WATER" });

  checks.push({
    check: "WATER search possible",
    pass:
      kumamotoResults.length > 0 &&
      kagoshimaResults.length > 0 &&
      ukiResults.length > 0 &&
      waterOnly.length > 0,
    kumamotoCount: kumamotoResults.length,
    kagoshimaCount: kagoshimaResults.length,
    ukiCount: ukiResults.length,
    waterCount: waterOnly.length
  });

  if (!kumamotoResults.length) {
    errors.push("WATER search failed: 熊本 給水");
  }
  if (!kagoshimaResults.length) {
    errors.push("WATER search failed: 霧島 給水");
  }
  if (!ukiResults.length) {
    errors.push("WATER search failed: 宇城 給水");
  }

  const ukiOfficial = ukiResults.some(function (item) {
    return /宇城/.test(item.municipality) && /公式/.test(item.organization);
  });
  if (!ukiOfficial) {
    errors.push("WATER search failed: 宇城市 official entry");
  }

  const volunteerKumamotoResults = searchDisasterIndex(payload, "熊本 ボランティア", {
    category: "VOLUNTEER"
  });
  const volunteerUkiResults = searchDisasterIndex(payload, "宇城 災害VC", {
    category: "VOLUNTEER"
  });
  const volunteerCategories = payload.index.filter(function (item) {
    return item.category === "VOLUNTEER";
  });

  const volunteerKagoshimaResults = searchDisasterIndex(payload, "鹿児島 ボランティア", {
    category: "VOLUNTEER"
  });
  const volunteerKirishimaResults = searchDisasterIndex(payload, "霧島 災害VC", {
    category: "VOLUNTEER"
  });
  const volunteerAiraResults = searchDisasterIndex(payload, "姶良 ボランティア", {
    category: "VOLUNTEER"
  });

  checks.push({
    check: "VOLUNTEER search possible",
    pass:
      volunteerKumamotoResults.length > 0 &&
      volunteerUkiResults.length > 0 &&
      volunteerKagoshimaResults.length > 0 &&
      volunteerKirishimaResults.length > 0 &&
      volunteerAiraResults.length > 0,
    kumamotoVolunteerCount: volunteerKumamotoResults.length,
    ukiVolunteerCount: volunteerUkiResults.length,
    kagoshimaVolunteerCount: volunteerKagoshimaResults.length,
    kirishimaVolunteerCount: volunteerKirishimaResults.length,
    airaVolunteerCount: volunteerAiraResults.length,
    volunteerIndexCount: volunteerCategories.length
  });

  if (!volunteerKumamotoResults.length) {
    errors.push("VOLUNTEER search failed: 熊本 ボランティア");
  }
  if (!volunteerUkiResults.length) {
    errors.push("VOLUNTEER search failed: 宇城 災害VC");
  }
  if (!volunteerKagoshimaResults.length) {
    errors.push("VOLUNTEER search failed: 鹿児島 ボランティア");
  }
  if (!volunteerKirishimaResults.length) {
    errors.push("VOLUNTEER search failed: 霧島 災害VC");
  }
  if (!volunteerAiraResults.length) {
    errors.push("VOLUNTEER search failed: 姶良 ボランティア");
  }
  if (volunteerCategories.length !== 20) {
    errors.push("expected 20 VOLUNTEER index entries (11 Kumamoto + 9 Kagoshima)");
  }

  const volunteerPrefectureEntry = volunteerCategories.find(function (item) {
    return item.source_url === "https://www.fukushi-kumamoto.or.jp/kvc/";
  });
  checks.push({
    check: "VOLUNTEER checked_at propagated",
    pass: Boolean(volunteerPrefectureEntry && volunteerPrefectureEntry.checked_at),
    checked_at: volunteerPrefectureEntry ? volunteerPrefectureEntry.checked_at : null
  });
  if (!volunteerPrefectureEntry || !volunteerPrefectureEntry.checked_at) {
    errors.push("timestamp propagation failed: 熊本県災害VC missing checked_at");
  }

  const waterLocationEntry = payload.index.find(function (item) {
    return (
      item.category === "WATER" &&
      item.municipality === "八代市" &&
      /鏡/.test(item.content || item.title || "")
    );
  });
  checks.push({
    check: "WATER source_updated_at propagated",
    pass: Boolean(waterLocationEntry && waterLocationEntry.source_updated_at),
    source_updated_at: waterLocationEntry ? waterLocationEntry.source_updated_at : null
  });
  if (!waterLocationEntry || !waterLocationEntry.source_updated_at) {
    errors.push("timestamp propagation failed: 八代市 WATER location missing source_updated_at");
  }

  const supportServiceCategories = payload.index.filter(function (item) {
    return item.category === "SUPPORT_SERVICE";
  });
  const supportShowerResults = searchDisasterIndex(payload, "シャワー", {
    category: "SUPPORT_SERVICE"
  });
  const supportCarCampResults = searchDisasterIndex(payload, "車中泊", {
    category: "SUPPORT_SERVICE"
  });
  const supportKumamotoResults = searchDisasterIndex(payload, "熊本 シャワー", {
    category: "SUPPORT_SERVICE"
  });

  checks.push({
    check: "SUPPORT_SERVICE search possible",
    pass:
      supportShowerResults.length > 0 &&
      supportCarCampResults.length > 0 &&
      supportKumamotoResults.length > 0,
    showerCount: supportShowerResults.length,
    carCampCount: supportCarCampResults.length,
    kumamotoCount: supportKumamotoResults.length,
    supportServiceIndexCount: supportServiceCategories.length
  });

  if (!supportShowerResults.length) {
    errors.push("SUPPORT_SERVICE search failed: シャワー");
  }
  if (!supportCarCampResults.length) {
    errors.push("SUPPORT_SERVICE search failed: 車中泊");
  }
  if (!supportKumamotoResults.length) {
    errors.push("SUPPORT_SERVICE search failed: 熊本 シャワー");
  }
  if (supportServiceCategories.length < 6) {
    errors.push("expected at least 6 SUPPORT_SERVICE index entries (test data + X public trace)");
  }
  const xSupportServiceCount = supportServiceCategories.filter(function (entry) {
    return entry.source_url && /x\.com/i.test(entry.source_url);
  }).length;
  if (xSupportServiceCount < 1) {
    errors.push("expected at least 1 X-derived SUPPORT_SERVICE index entry");
  }

  supportServiceCategories.forEach(function (entry, index) {
    if (!entry.subcategory || !entry.opening_type || !entry.provider_type || !entry.verification_status) {
      errors.push("SUPPORT_SERVICE index[" + index + "]: missing required support fields");
    }
    if (OPENING_TYPE_VALUES.indexOf(entry.opening_type) === -1) {
      errors.push("SUPPORT_SERVICE index[" + index + "]: invalid opening_type " + entry.opening_type);
    }
    if (PROVIDER_TYPE_VALUES.indexOf(entry.provider_type) === -1) {
      errors.push("SUPPORT_SERVICE index[" + index + "]: invalid provider_type " + entry.provider_type);
    }
  });

  const supportServiceResult = validateSupportServiceIndexExample();
  checks.push({
    check: "SUPPORT_SERVICE schema compatible",
    pass:
      supportServiceResult.schemaErrors.length === 0 &&
      supportServiceResult.indexErrors.length === 0,
    schemaErrors: supportServiceResult.schemaErrors,
    indexErrors: supportServiceResult.indexErrors
  });
  errors.push.apply(
    errors,
    supportServiceResult.schemaErrors.map(function (message) {
      return "SUPPORT_SERVICE schema: " + message;
    })
  );
  errors.push.apply(
    errors,
    supportServiceResult.indexErrors.map(function (message) {
      return "SUPPORT_SERVICE index: " + message;
    })
  );

  const volunteerResult = validateVolunteerIndexExample();
  checks.push({
    check: "VOLUNTEER schema compatible",
    pass: volunteerResult.schemaErrors.length === 0 && volunteerResult.indexErrors.length === 0,
    schemaErrors: volunteerResult.schemaErrors,
    indexErrors: volunteerResult.indexErrors
  });
  errors.push.apply(
    errors,
    volunteerResult.schemaErrors.map(function (message) {
      return "VOLUNTEER schema: " + message;
    })
  );
  errors.push.apply(
    errors,
    volunteerResult.indexErrors.map(function (message) {
      return "VOLUNTEER index: " + message;
    })
  );

  const shelterCategories = payload.index.filter(function (item) {
    return item.category === "SHELTER";
  });
  const shelterMinamataResults = searchDisasterIndex(payload, "水俣 避難所", { category: "SHELTER" });
  const shelterTaragiResults = searchDisasterIndex(payload, "多良木 避難所", { category: "SHELTER" });

  checks.push({
    check: "SHELTER registry preserved",
    pass: shelterCategories.length >= 9,
    shelterCount: shelterCategories.length
  });
  checks.push({
    check: "SHELTER search possible",
    pass: shelterMinamataResults.length > 0 && shelterTaragiResults.length > 0,
    minamataCount: shelterMinamataResults.length,
    taragiCount: shelterTaragiResults.length
  });

  if (shelterCategories.length < 9) {
    errors.push("expected at least 9 SHELTER registry entries (KM014-KM022)");
  }
  if (!shelterMinamataResults.length) {
    errors.push("SHELTER search failed: 水俣 避難所");
  }
  if (!shelterTaragiResults.length) {
    errors.push("SHELTER search failed: 多良木 避難所");
  }

  shelterCategories.forEach(function (entry, index) {
    if (!entry.source_trace || !entry.area_id || !entry.source_id || entry.status !== "PENDING") {
      errors.push("SHELTER registry[" + index + "]: invalid applied registry schema");
    }
  });

  if (!fs.existsSync(OUTPUT_FILE)) {
    errors.push("Missing output: data/disaster_search_index.json");
  }

  const output = {
    DISASTER_SEARCH_INDEX_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    region: payload.region,
    itemCount: payload.index.length,
    categories: categories,
    checks: checks,
    ukiSample: ukiResults.slice(0, 3).map(function (item) {
      return {
        municipality: item.municipality,
        organization: item.organization,
        title: item.title
      };
    }),
    errors: errors
  };

  console.log("=== Disaster Search Index Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_DISASTER_SEARCH_INDEX_COMPLETE");
}

main();
