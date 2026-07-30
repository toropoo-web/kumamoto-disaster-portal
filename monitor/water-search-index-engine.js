"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CROSS_VIEW_FILE = path.join(ROOT, "data", "water_cross_view.json");
const WATER_SOURCES_FILE = path.join(ROOT, "data", "water_sources.json");
const OUTPUT_FILE = path.join(ROOT, "data", "water_search_index.json");
const PUBLIC_OUTPUT_FILE = path.join(ROOT, "data", "public", "water_search_index.json");

const REGIONS = ["熊本県", "鹿児島県"];
const DEFAULT_REGION = "熊本県";
const DEFAULT_KEYWORDS = ["給水", "応急給水", "給水所", "給水車", "断水", "水道", "復旧"];

const TARGET_MUNICIPALITIES = new Set(["八代市", "宇城市", "人吉市"]);
const MUNICIPALITY_PATTERN = /^(熊本|八代|宇城|人吉|菊池|合志|玉名|天草|鹿児島|霧島|鹿屋|薩摩川内|姶良|出水)市$/;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function resolveMunicipality(organization, region) {
  if (!organization) {
    return region || "";
  }

  if (MUNICIPALITY_PATTERN.test(organization)) {
    return organization;
  }

  const bureauMatch = organization.match(/^(熊本|鹿児島)市上下水道局$/);
  if (bureauMatch) {
    return bureauMatch[1] + "市";
  }

  if (/県/.test(organization) || /消防庁|海上保安庁|自衛隊/.test(organization)) {
    return region || organization;
  }

  return organization;
}

function buildSourceLabel(organization) {
  if (!organization) {
    return "公式情報";
  }
  if (/公式/.test(organization)) {
    return organization;
  }
  if (/市$|町$|村$/.test(organization)) {
    return organization + "公式";
  }
  if (/防災|上下水道|企業団/.test(organization)) {
    return organization;
  }
  return organization + "公式";
}

function buildSearchText(parts) {
  return parts.filter(Boolean).join(" ");
}

function buildLocationSearchText(entry, location) {
  const parts = [
    DEFAULT_REGION,
    entry.municipality,
    location.location_name,
    location.status_label || "給水対応中",
    "給水",
    "給水所"
  ];

  if (/給水車/.test(location.location_name)) {
    parts.push("給水車");
  } else {
    parts.push("応急給水");
  }

  return buildSearchText(parts);
}

function toLocationSearchItem(entry, location) {
  const sourceLabel = entry.source_label || entry.municipality + "公式";

  return {
    item_kind: "location",
    region: DEFAULT_REGION,
    municipality: entry.municipality,
    organization: sourceLabel,
    location: location.location_name,
    title: location.status_label || "給水対応中",
    search_text: buildLocationSearchText(entry, location),
    source_name: sourceLabel,
    source_type: "official",
    source_url: location.source_url || entry.source_url || null,
    updated_at: location.updated_at || null
  };
}

function toRegistrySearchItem(source) {
  const municipality = resolveMunicipality(source.organization, source.region);
  const keywords = Array.isArray(source.keywords) && source.keywords.length
    ? source.keywords
    : DEFAULT_KEYWORDS.slice();
  const sourceLabel = buildSourceLabel(source.organization);

  return {
    item_kind: "registry",
    region: source.region,
    municipality: municipality,
    organization: source.organization,
    location: "給水関連情報",
    title: "給水関連情報",
    search_text: buildSearchText([
      source.region,
      municipality,
      source.organization,
      "給水関連情報",
      keywords.join(" ")
    ]),
    source_name: sourceLabel,
    source_type: "official",
    source_url: source.url || null,
    updated_at: null
  };
}

function buildLocationItems(crossView) {
  const items = [];

  (crossView.municipalities || []).forEach(function (entry) {
    if (!TARGET_MUNICIPALITIES.has(entry.municipality)) {
      return;
    }

    (entry.locations || []).forEach(function (location) {
      if (!location || location.source_type !== "official") {
        return;
      }
      items.push(toLocationSearchItem(entry, location));
    });
  });

  return items;
}

function buildRegistryItems(waterSources) {
  const items = [];

  (waterSources.sources || []).forEach(function (source) {
    if (!source || source.official !== true || source.source_type !== "official") {
      return;
    }
    if (!source.region || !source.organization || !source.url) {
      return;
    }
    items.push(toRegistrySearchItem(source));
  });

  return items;
}

function buildWaterSearchIndex(options) {
  options = options || {};
  const crossView = readJson(options.crossViewPath || CROSS_VIEW_FILE, { municipalities: [] });
  const waterSources = readJson(options.waterSourcesPath || WATER_SOURCES_FILE, { sources: [] });
  const locationItems = buildLocationItems(crossView);
  const registryItems = buildRegistryItems(waterSources);

  return {
    category: "WATER",
    version: 2,
    regions: REGIONS.slice(),
    source_registry: "data/water_sources.json",
    location_item_count: locationItems.length,
    registry_item_count: registryItems.length,
    item_count: locationItems.length + registryItems.length,
    last_updated: new Date().toISOString(),
    items: locationItems.concat(registryItems)
  };
}

function buildAndWriteWaterSearchIndex(options) {
  const payload = buildWaterSearchIndex(options);
  writeJson(OUTPUT_FILE, payload);
  writeJson(PUBLIC_OUTPUT_FILE, payload);
  return payload;
}

function validateWaterSources(registry) {
  const errors = [];

  if (!registry || registry.category !== "WATER") {
    errors.push("water_sources.json: category must be WATER");
  }

  if (!Array.isArray(registry.regions) || registry.regions.indexOf("熊本県") === -1) {
    errors.push("water_sources.json: regions must include 熊本県");
  }

  if (!Array.isArray(registry.regions) || registry.regions.indexOf("鹿児島県") === -1) {
    errors.push("water_sources.json: regions must include 鹿児島県");
  }

  if (!Array.isArray(registry.sources) || registry.sources.length === 0) {
    errors.push("water_sources.json: sources must not be empty");
    return errors;
  }

  const requiredOrganizations = [
    "熊本県防災情報",
    "熊本市",
    "八代市",
    "宇城市",
    "人吉市",
    "菊池市",
    "合志市",
    "玉名市",
    "天草市",
    "鹿児島県防災情報",
    "鹿児島市",
    "霧島市",
    "鹿屋市",
    "薩摩川内市",
    "姶良市",
    "出水市",
    "消防庁",
    "海上保安庁"
  ];

  const organizations = new Set();

  registry.sources.forEach(function (source, index) {
    const label = "water_sources.sources[" + index + "]";

    ["region", "organization", "source_type", "url"].forEach(function (field) {
      if (!source[field]) {
        errors.push(label + ": missing " + field);
      }
    });

    if (source.source_type !== "official") {
      errors.push(label + ": source_type must be official");
    }

    if (source.official !== true) {
      errors.push(label + ": official must be true");
    }

    if (source.region !== "熊本県" && source.region !== "鹿児島県") {
      errors.push(label + ": invalid region");
    }

    if (source.url && /x\.com|twitter\.com|instagram\.com|facebook\.com/i.test(source.url)) {
      errors.push(label + ": personal SNS URL is not allowed");
    }

    organizations.add(source.organization);
  });

  requiredOrganizations.forEach(function (name) {
    if (!organizations.has(name)) {
      errors.push("water_sources.json: missing organization " + name);
    }
  });

  return errors;
}

function validateWaterSearchIndex(payload) {
  const errors = [];

  if (!payload || payload.category !== "WATER") {
    errors.push("category must be WATER");
  }

  if (payload.version !== 2) {
    errors.push("version must be 2");
  }

  if (!Array.isArray(payload.regions) || payload.regions.indexOf("熊本県") === -1) {
    errors.push("regions must include 熊本県");
  }

  if (!Array.isArray(payload.regions) || payload.regions.indexOf("鹿児島県") === -1) {
    errors.push("regions must include 鹿児島県");
  }

  if (!Array.isArray(payload.items)) {
    errors.push("items must be an array");
    return errors;
  }

  const municipalities = new Set();
  let locationCount = 0;
  let registryCount = 0;
  let kagoshimaCount = 0;

  payload.items.forEach(function (item, index) {
    const label = "items[" + index + "]";

    ["region", "municipality", "organization", "location", "title", "search_text", "source_name", "source_type"].forEach(function (field) {
      if (!item[field]) {
        errors.push(label + ": missing " + field);
      }
    });

    if (item.source_type !== "official") {
      errors.push(label + ": source_type must be official");
    }

    if (item.region !== "熊本県" && item.region !== "鹿児島県") {
      errors.push(label + ": invalid region");
    }

    if (item.item_kind === "location") {
      locationCount += 1;
    } else if (item.item_kind === "registry") {
      registryCount += 1;
    } else {
      errors.push(label + ": invalid item_kind");
    }

    if (item.region === "鹿児島県") {
      kagoshimaCount += 1;
    }

    municipalities.add(item.municipality);
  });

  ["八代市", "宇城市", "人吉市"].forEach(function (name) {
    if (!municipalities.has(name)) {
      errors.push("missing municipality items: " + name);
    }
  });

  if (locationCount !== 22) {
    errors.push("location_item_count must remain 22, got " + locationCount);
  }

  if (registryCount === 0) {
    errors.push("registry_item_count must be greater than 0");
  }

  if (kagoshimaCount === 0) {
    errors.push("items must include 鹿児島県 registry entries");
  }

  if (payload.items.length === 0) {
    errors.push("items must not be empty");
  }

  return errors;
}

module.exports = {
  CROSS_VIEW_FILE,
  WATER_SOURCES_FILE,
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  buildWaterSearchIndex,
  buildAndWriteWaterSearchIndex,
  validateWaterSources,
  validateWaterSearchIndex
};
