"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");
const WATER_SOURCES_FILE = path.join(ROOT, "data", "water_sources.json");

const REGION_KYUSHU_SOUTH = "KYUSHU_SOUTH";

const PREFECTURES = {
  KYUSHU_SOUTH: ["熊本県", "鹿児島県"]
};

const CATEGORIES = ["WATER", "VOLUNTEER", "SHELTER", "MEDICAL", "SUPPORT"];

const SOURCE_TYPES = [
  "MUNICIPALITY",
  "WATERWORKS",
  "DISASTER",
  "SELF_DEFENSE",
  "FIRE",
  "COAST_GUARD",
  "SOCIAL_WELFARE",
  "NPO",
  "GOVERNMENT",
  "PUBLIC_ORGANIZATION"
];

const WATER_KEYWORDS = [
  "給水",
  "応急給水",
  "給水所",
  "給水車",
  "断水",
  "水道",
  "復旧"
];

const KAGOSHIMA_WATER_PLACEHOLDER_MUNICIPALITIES = [
  "伊佐市",
  "阿久根市",
  "指宿市"
];

function buildSourceId(category, prefecture, organization, url) {
  return (
    "DSRC-" +
    category.slice(0, 3) +
    "-" +
    crypto
      .createHash("sha256")
      .update([category, prefecture, organization, url].join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function inferSourceType(organization) {
  if (!organization) {
    return "DISASTER";
  }
  if (/上下水道|水道企業団/.test(organization)) {
    return "WATERWORKS";
  }
  if (/自衛隊/.test(organization)) {
    return "SELF_DEFENSE";
  }
  if (/消防庁/.test(organization)) {
    return "FIRE";
  }
  if (/海上保安庁/.test(organization)) {
    return "COAST_GUARD";
  }
  if (/社会福祉協議会|社協/.test(organization)) {
    return "SOCIAL_WELFARE";
  }
  if (/NPO|ボランティア/.test(organization)) {
    return "NPO";
  }
  if (/防災/.test(organization)) {
    return "DISASTER";
  }
  if (/県$/.test(organization)) {
    return "GOVERNMENT";
  }
  if (/市$|町$|村$/.test(organization)) {
    return "MUNICIPALITY";
  }
  return "PUBLIC_ORGANIZATION";
}

function resolveMunicipality(prefecture, organization) {
  if (/市$|町$|村$/.test(organization)) {
    return organization;
  }
  if (/県/.test(organization)) {
    return prefecture;
  }
  return organization;
}

function readDisasterRegistry() {
  if (!fs.existsSync(DISASTER_SOURCES_FILE)) {
    return { version: "1.0", region: REGION_KYUSHU_SOUTH, sources: [] };
  }
  return JSON.parse(fs.readFileSync(DISASTER_SOURCES_FILE, "utf8"));
}

function readWaterRegistry() {
  if (!fs.existsSync(WATER_SOURCES_FILE)) {
    return { category: "WATER", regions: [], sources: [] };
  }
  return JSON.parse(fs.readFileSync(WATER_SOURCES_FILE, "utf8"));
}

function convertWaterEntryToDisasterSource(entry) {
  const prefecture = entry.region || "";
  const organization = entry.organization || "";
  const url = entry.url || "";

  return {
    source_id: buildSourceId("WATER", prefecture, organization, url),
    category: "WATER",
    prefecture: prefecture,
    municipality: resolveMunicipality(prefecture, organization),
    organization: organization,
    source_type: inferSourceType(organization),
    url: url,
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice() : WATER_KEYWORDS.slice(),
    extractor: {},
    official: entry.official === true,
    active: true
  };
}

function buildKagoshimaWaterPlaceholders() {
  return KAGOSHIMA_WATER_PLACEHOLDER_MUNICIPALITIES.map(function (municipality) {
    return {
      source_id: buildSourceId("WATER", "鹿児島県", municipality, "placeholder:" + municipality),
      category: "WATER",
      prefecture: "鹿児島県",
      municipality: municipality,
      organization: municipality,
      source_type: "MUNICIPALITY",
      url: "",
      keywords: WATER_KEYWORDS.slice(),
      extractor: {},
      official: true,
      active: false
    };
  });
}

function buildDisasterRegistryFromWater() {
  const waterRegistry = readWaterRegistry();
  const migrated = (waterRegistry.sources || []).map(convertWaterEntryToDisasterSource);
  const placeholders = buildKagoshimaWaterPlaceholders();

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    sources: migrated.concat(placeholders)
  };
}

function getDisasterSources(category, options) {
  options = options || {};
  const registry = readDisasterRegistry();
  let sources = (registry.sources || []).filter(function (entry) {
    if (category && entry.category !== category) {
      return false;
    }
    if (options.activeOnly && entry.active !== true) {
      return false;
    }
    if (options.prefecture && entry.prefecture !== options.prefecture) {
      return false;
    }
    if (options.officialOnly && entry.official !== true) {
      return false;
    }
    return true;
  });

  return sources;
}

function toLegacyWaterSource(entry) {
  return {
    region: entry.prefecture,
    organization: entry.organization,
    source_type: "official",
    url: entry.url,
    keywords: Array.isArray(entry.keywords) ? entry.keywords.slice() : [],
    official: entry.official === true
  };
}

function loadWaterSources() {
  const sources = getDisasterSources("WATER", { activeOnly: true, officialOnly: true });
  const prefectures = {};

  sources.forEach(function (entry) {
    prefectures[entry.prefecture] = true;
  });

  return {
    category: "WATER",
    regions: Object.keys(prefectures).sort(),
    sources: sources.map(toLegacyWaterSource)
  };
}

function validateVolunteerSchemaExample() {
  const example = {
    source_id: "DSRC-VOL-EXAMPLE-0001",
    category: "VOLUNTEER",
    prefecture: "熊本県",
    municipality: "熊本県",
    organization: "社会福祉協議会",
    source_type: "SOCIAL_WELFARE",
    url: "https://example.invalid/volunteer-placeholder",
    keywords: ["災害ボランティア", "募集", "受付", "活動"],
    extractor: {},
    official: true,
    active: false
  };

  return validateDisasterSourceEntry(example, 0, { allowInactiveWithoutUrl: true });
}

function validateDisasterSourceEntry(entry, index, options) {
  options = options || {};
  const label = "sources[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  if (!entry.source_id) {
    errors.push(label + ": source_id missing");
  }

  if (CATEGORIES.indexOf(entry.category) === -1) {
    errors.push(label + ": invalid category " + entry.category);
  }

  if (!entry.prefecture) {
    errors.push(label + ": prefecture missing");
  } else if (PREFECTURES[REGION_KYUSHU_SOUTH].indexOf(entry.prefecture) === -1) {
    errors.push(label + ": prefecture not in KYUSHU_SOUTH coverage");
  }

  if (!entry.organization) {
    errors.push(label + ": organization missing");
  }

  if (SOURCE_TYPES.indexOf(entry.source_type) === -1) {
    errors.push(label + ": invalid source_type " + entry.source_type);
  }

  if (entry.official !== true && entry.official !== false) {
    errors.push(label + ": official field missing");
  }

  if (entry.active === true && !entry.url) {
    errors.push(label + ": url missing for active source");
  }

  if (entry.active !== true && entry.active !== false) {
    errors.push(label + ": active field missing");
  }

  if (!Array.isArray(entry.keywords)) {
    errors.push(label + ": keywords must be an array");
  }

  if (entry.extractor === undefined || typeof entry.extractor !== "object" || Array.isArray(entry.extractor)) {
    errors.push(label + ": extractor must be an object");
  }

  return errors;
}

function validateDisasterRegistry() {
  const errors = [];
  const registry = readDisasterRegistry();
  const ids = new Set();

  if (registry.version !== "1.0") {
    errors.push("disaster_sources.json version must be 1.0");
  }

  if (registry.region !== REGION_KYUSHU_SOUTH) {
    errors.push("disaster_sources.json region must be KYUSHU_SOUTH");
  }

  if (!Array.isArray(registry.sources) || !registry.sources.length) {
    errors.push("disaster_sources.json sources must not be empty");
    return { errors: errors, sourceCount: 0, categoryCounts: {} };
  }

  registry.sources.forEach(function (entry, index) {
    errors.push.apply(errors, validateDisasterSourceEntry(entry, index, { allowInactiveWithoutUrl: true }));

    if (entry.source_id) {
      if (ids.has(entry.source_id)) {
        errors.push("duplicate source_id: " + entry.source_id);
      }
      ids.add(entry.source_id);
    }
  });

  const categoryCounts = CATEGORIES.reduce(function (acc, name) {
    acc[name] = registry.sources.filter(function (entry) {
      return entry.category === name;
    }).length;
    return acc;
  }, {});

  if (!categoryCounts.WATER) {
    errors.push("disaster_sources.json must include WATER sources");
  }

  return {
    errors: errors,
    sourceCount: registry.sources.length,
    categoryCounts: categoryCounts
  };
}

function validateWaterCompatibility() {
  const errors = [];
  const waterRegistry = readWaterRegistry();
  const adapted = loadWaterSources();

  if (waterRegistry.category !== "WATER") {
    errors.push("water_sources.json category must remain WATER");
  }

  const legacyUrls = new Set(
    (waterRegistry.sources || [])
      .filter(function (entry) {
        return entry && entry.url;
      })
      .map(function (entry) {
        return entry.region + "|" + entry.organization + "|" + entry.url;
      })
  );

  const adaptedUrls = new Set(
    (adapted.sources || []).map(function (entry) {
      return entry.region + "|" + entry.organization + "|" + entry.url;
    })
  );

  legacyUrls.forEach(function (key) {
    if (!adaptedUrls.has(key)) {
      errors.push("disaster_sources WATER adapter missing legacy source: " + key);
    }
  });

  adaptedUrls.forEach(function (key) {
    if (!legacyUrls.has(key)) {
      errors.push("disaster_sources WATER adapter has unexpected source: " + key);
    }
  });

  (waterRegistry.sources || []).forEach(function (entry, index) {
    if (entry.official !== true) {
      errors.push("water_sources.sources[" + index + "]: official must remain true");
    }
  });

  return errors;
}

module.exports = {
  DISASTER_SOURCES_FILE,
  WATER_SOURCES_FILE,
  REGION_KYUSHU_SOUTH,
  PREFECTURES,
  CATEGORIES,
  SOURCE_TYPES,
  WATER_KEYWORDS,
  buildSourceId,
  inferSourceType,
  resolveMunicipality,
  readDisasterRegistry,
  readWaterRegistry,
  convertWaterEntryToDisasterSource,
  buildDisasterRegistryFromWater,
  getDisasterSources,
  loadWaterSources,
  toLegacyWaterSource,
  validateDisasterRegistry,
  validateDisasterSourceEntry,
  validateWaterCompatibility,
  validateVolunteerSchemaExample
};
