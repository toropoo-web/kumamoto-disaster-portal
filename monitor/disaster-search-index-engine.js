"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  REGION_KYUSHU_SOUTH,
  PREFECTURES,
  CATEGORIES,
  WATER_KEYWORDS,
  VOLUNTEER_KEYWORDS,
  CAPABILITY_STATUS,
  CAPABILITY_STATUS_VALUES,
  VOLUNTEER_DISASTER_START_DATE,
  buildVolunteerSchemaExample,
  isVolunteerPublishedForCurrentDisaster,
  resolveMunicipality,
  validateVolunteerSchemaExample
} = require("./disaster-sources");

const ROOT = path.join(__dirname, "..");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");
const CROSS_VIEW_FILE = path.join(ROOT, "data", "water_cross_view.json");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "water-snapshots.json");
const SNAPSHOT_SEED_FILE = path.join(__dirname, "baselines", "water-snapshots.seed.json");
const OUTPUT_FILE = path.join(ROOT, "data", "disaster_search_index.json");
const PUBLIC_OUTPUT_FILE = path.join(ROOT, "data", "public", "disaster_search_index.json");

const DISASTER_WATER_KEYWORDS = WATER_KEYWORDS.concat(["飲料水", "生活用水"]);

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

function buildIndexId(parts) {
  return (
    "DIDX-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 12)
      .toUpperCase()
  );
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

function normalizeSearchText(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[\uff01-\uff5e]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function mergeKeywords(baseKeywords, extraKeywords) {
  const merged = [];
  const seen = {};

  (baseKeywords || []).concat(extraKeywords || []).forEach(function (keyword) {
    if (!keyword || seen[keyword]) {
      return;
    }
    seen[keyword] = true;
    merged.push(keyword);
  });

  return merged;
}

function readWaterSnapshots(options) {
  options = options || {};
  const snapshotPath = options.snapshotPath || SNAPSHOT_FILE;
  const seedPath = options.snapshotSeedPath || SNAPSHOT_SEED_FILE;

  if (fs.existsSync(snapshotPath)) {
    return readJson(snapshotPath, { version: 1, category: "WATER", sources: {} });
  }

  return readJson(seedPath, { version: 1, category: "WATER", sources: {} });
}

function parseFacilitiesFromOriginalText(originalText) {
  const facilities = [];
  const lines = String(originalText || "").split(/\r?\n/);

  lines.forEach(function (line) {
    const match = line.match(/^施設名[：:]\s*(.+)$/);
    if (match && match[1]) {
      facilities.push(match[1].trim());
    }
  });

  return facilities;
}

function parseMunicipalityFromOriginalText(originalText) {
  const match = String(originalText || "").match(/^自治体[：:]\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function toLocationIndexEntry(entry, location, sourceLookup) {
  const prefecture = sourceLookup.prefecture || "熊本県";
  const organization = entry.source_label || buildSourceLabel(entry.municipality);
  const keywords = mergeKeywords(DISASTER_WATER_KEYWORDS, []);
  const title = location.status_label || entry.status_label || "給水情報";
  const content = [
    prefecture,
    entry.municipality,
    location.location_name,
    title,
    keywords.join(" ")
  ].join(" ");

  return {
    index_id: buildIndexId([
      "WATER",
      "location",
      location.location_id || entry.municipality,
      location.location_name
    ]),
    category: "WATER",
    prefecture: prefecture,
    municipality: entry.municipality,
    organization: organization,
    title: title,
    content: content,
    keywords: keywords,
    source_type: "MUNICIPALITY",
    source_url: location.source_url || entry.source_url || sourceLookup.url || "",
    official: true,
    updated_at: location.updated_at || entry.last_updated || null
  };
}

function toRegistryIndexEntry(source) {
  const keywords = mergeKeywords(
    DISASTER_WATER_KEYWORDS,
    Array.isArray(source.keywords) ? source.keywords : []
  );
  const organizationLabel = buildSourceLabel(source.organization);
  const title = "給水情報";
  const content = [
    source.prefecture,
    source.municipality,
    source.organization,
    title,
    keywords.join(" ")
  ].join(" ");

  return {
    index_id: buildIndexId(["WATER", "registry", source.source_id]),
    category: "WATER",
    prefecture: source.prefecture,
    municipality: source.municipality,
    organization: organizationLabel,
    title: title,
    content: content,
    keywords: keywords,
    source_type: source.source_type || "MUNICIPALITY",
    source_url: source.url,
    official: true,
    updated_at: null
  };
}

function toSnapshotFacilityIndexEntry(snapshot, facilityName, sourceMeta) {
  const municipality =
    snapshot.municipality ||
    parseMunicipalityFromOriginalText(snapshot.originalText) ||
    sourceMeta.municipality ||
    sourceMeta.organization;
  const prefecture = sourceMeta.prefecture || "熊本県";
  const organization = buildSourceLabel(sourceMeta.organization || municipality);
  const keywords = mergeKeywords(
    DISASTER_WATER_KEYWORDS,
    Array.isArray(snapshot.keywords) ? snapshot.keywords : []
  );
  const title = "給水情報";
  const content = [prefecture, municipality, facilityName, title, keywords.join(" ")].join(" ");

  return {
    index_id: buildIndexId([
      "WATER",
      "snapshot",
      snapshot.source_id || sourceMeta.source_id,
      facilityName
    ]),
    category: "WATER",
    prefecture: prefecture,
    municipality: municipality,
    organization: organization,
    title: title,
    content: content,
    keywords: keywords,
    source_type: sourceMeta.source_type || "MUNICIPALITY",
    source_url: snapshot.url || sourceMeta.url || "",
    official: true,
    updated_at: snapshot.fetched_at || null
  };
}

function buildSourceLookup(disasterSources) {
  const lookup = {};

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "WATER") {
      return;
    }
    lookup[source.source_id] = source;
    lookup[source.organization] = source;
    lookup[source.municipality] = source;
  });

  return lookup;
}

function buildCrossViewLocationItems(crossView, sourceLookup) {
  const items = [];

  (crossView.municipalities || []).forEach(function (entry) {
    const sourceMeta =
      sourceLookup[entry.municipality] ||
      sourceLookup[entry.source_label] || {
        prefecture: "熊本県",
        url: entry.source_url || ""
      };

    (entry.locations || []).forEach(function (location) {
      if (!location || location.source_type !== "official") {
        return;
      }
      if (!location.source_url && !entry.source_url && !sourceMeta.url) {
        return;
      }

      items.push(toLocationIndexEntry(entry, location, sourceMeta));
    });
  });

  return items;
}

function toVolunteerRegistryIndexEntry(source) {
  const keywords = mergeKeywords(
    VOLUNTEER_KEYWORDS,
    Array.isArray(source.keywords) ? source.keywords : []
  );
  const organizationLabel = buildSourceLabel(source.organization);
  const title = "災害ボランティア募集";
  const content = [
    source.prefecture,
    source.municipality,
    source.organization,
    title,
    keywords.join(" "),
    source.capability_status
  ].join(" ");

  return {
    index_id: buildIndexId(["VOLUNTEER", "registry", source.source_id]),
    category: "VOLUNTEER",
    prefecture: source.prefecture,
    municipality: source.municipality,
    organization: organizationLabel,
    title: title,
    content: content,
    keywords: keywords,
    capability_status: source.capability_status,
    published_at: source.published_at,
    disaster_start_date: source.disaster_start_date || VOLUNTEER_DISASTER_START_DATE,
    source_type: source.source_type || "SOCIAL_WELFARE",
    source_url: source.url,
    official: true,
    updated_at: null,
    current_capability: source.current_capability || null
  };
}

function buildVolunteerRegistryItems(disasterSources) {
  const items = [];

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "VOLUNTEER") {
      return;
    }
    if (source.official !== true || source.active !== true) {
      return;
    }
    if (!source.url) {
      return;
    }
    if (source.capability_status === CAPABILITY_STATUS.HISTORICAL_ONLY) {
      return;
    }
    if (!isVolunteerPublishedForCurrentDisaster(source)) {
      return;
    }
    items.push(toVolunteerRegistryIndexEntry(source));
  });

  return items;
}

function buildRegistryItems(disasterSources) {
  const items = [];

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "WATER") {
      return;
    }
    if (source.official !== true || source.active !== true) {
      return;
    }
    if (!source.url) {
      return;
    }
    items.push(toRegistryIndexEntry(source));
  });

  return items;
}

function buildSnapshotFacilityItems(snapshots, disasterSources) {
  const items = [];
  const sourceLookup = buildSourceLookup(disasterSources);
  const sources = snapshots.sources || {};

  Object.keys(sources).forEach(function (key) {
    const snapshot = sources[key];
    if (!snapshot || snapshot.reachable !== true) {
      return;
    }
    if (!snapshot.url) {
      return;
    }

    const sourceMeta =
      sourceLookup[snapshot.source_id] ||
      sourceLookup[snapshot.organization] ||
      sourceLookup[snapshot.municipality] || {
        prefecture: /鹿児島/.test(snapshot.region || "") ? "鹿児島県" : "熊本県",
        municipality: snapshot.municipality || snapshot.organization,
        organization: snapshot.organization,
        url: snapshot.url,
        source_type: "MUNICIPALITY"
      };

    const facilities = parseFacilitiesFromOriginalText(snapshot.originalText);
    if (!facilities.length) {
      return;
    }

    facilities.forEach(function (facilityName) {
      items.push(toSnapshotFacilityIndexEntry(snapshot, facilityName, sourceMeta));
    });
  });

  return items;
}

function dedupeIndexItems(items) {
  const seen = new Set();
  const deduped = [];

  items.forEach(function (item) {
    if (!item || !item.index_id || seen.has(item.index_id)) {
      return;
    }
    seen.add(item.index_id);
    deduped.push(item);
  });

  return deduped;
}

function buildDisasterSearchIndex(options) {
  options = options || {};

  const disasterSources = readJson(
    options.disasterSourcesPath || DISASTER_SOURCES_FILE,
    { version: "1.0", region: REGION_KYUSHU_SOUTH, sources: [] }
  );
  const crossView = readJson(options.crossViewPath || CROSS_VIEW_FILE, { municipalities: [] });
  const snapshots = readWaterSnapshots(options);
  const sourceLookup = buildSourceLookup(disasterSources);

  const locationItems = buildCrossViewLocationItems(crossView, sourceLookup);
  const registryItems = buildRegistryItems(disasterSources);
  const snapshotItems = buildSnapshotFacilityItems(snapshots, disasterSources);
  const volunteerRegistryItems = buildVolunteerRegistryItems(disasterSources);
  const index = dedupeIndexItems(
    locationItems.concat(registryItems, snapshotItems, volunteerRegistryItems)
  );

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    index: index,
    meta: {
      location_item_count: locationItems.length,
      registry_item_count: registryItems.length,
      snapshot_item_count: snapshotItems.length,
      volunteer_registry_item_count: volunteerRegistryItems.length,
      item_count: index.length,
      last_updated: new Date().toISOString()
    }
  };
}

function buildAndWriteDisasterSearchIndex(options) {
  options = options || {};
  const payload = buildDisasterSearchIndex(options);
  const output = {
    version: payload.version,
    region: payload.region,
    index: payload.index
  };
  writeJson(options.outputPath || OUTPUT_FILE, output);
  writeJson(options.publicOutputPath || PUBLIC_OUTPUT_FILE, output);
  return payload;
}

function searchDisasterIndex(indexPayload, query, options) {
  options = options || {};
  const items = (indexPayload && indexPayload.index) || [];
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);

  if (!tokens.length) {
    return [];
  }

  return items.filter(function (item) {
    if (options.category && item.category !== options.category) {
      return false;
    }

    if (options.prefecture && item.prefecture !== options.prefecture) {
      return false;
    }

    const hay = normalizeSearchText(
      [
        item.prefecture,
        item.municipality,
        item.organization,
        item.title,
        (item.keywords || []).join(" "),
        item.content,
        item.capability_status || ""
      ].join(" ")
    );

    return tokens.every(function (token) {
      return hay.indexOf(token) !== -1;
    });
  });
}

function validateDisasterSearchIndexEntry(entry, index) {
  const label = "index[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "index_id",
    "category",
    "prefecture",
    "municipality",
    "organization",
    "title",
    "content",
    "source_type",
    "source_url"
  ].forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (!Array.isArray(entry.keywords)) {
    errors.push(label + ": keywords must be an array");
  }

  if (entry.official !== true) {
    errors.push(label + ": official must be true");
  }

  if (CATEGORIES.indexOf(entry.category) === -1) {
    errors.push(label + ": invalid category " + entry.category);
  }

  if (PREFECTURES[REGION_KYUSHU_SOUTH].indexOf(entry.prefecture) === -1) {
    errors.push(label + ": prefecture not in KYUSHU_SOUTH coverage");
  }

  if (entry.category === "VOLUNTEER") {
    if (!entry.capability_status) {
      errors.push(label + ": missing capability_status");
    } else if (CAPABILITY_STATUS_VALUES.indexOf(entry.capability_status) === -1) {
      errors.push(label + ": invalid capability_status " + entry.capability_status);
    }
    if (!entry.published_at) {
      errors.push(label + ": missing published_at");
    }
    if (!entry.disaster_start_date) {
      errors.push(label + ": missing disaster_start_date");
    }
  }

  return errors;
}

function validateVolunteerIndexExample() {
  const source = buildVolunteerSchemaExample({
    source_id: buildIndexId(["VOLUNTEER", "example-source"]),
    active: true
  });
  const example = toVolunteerRegistryIndexEntry(source);
  const schemaErrors = validateVolunteerSchemaExample();
  const indexErrors = validateDisasterSearchIndexEntry(example, 0);
  const historicalHay = normalizeSearchText((source.historical_evidence || []).join(" "));
  const searchHay = normalizeSearchText(
    [
      example.prefecture,
      example.municipality,
      example.organization,
      example.title,
      (example.keywords || []).join(" "),
      example.content,
      example.capability_status || ""
    ].join(" ")
  );
  const separationErrors = [];

  if (historicalHay && searchHay.indexOf(historicalHay) !== -1) {
    separationErrors.push("historical_evidence must not be included in search haystack");
  }

  return {
    schemaErrors: schemaErrors,
    indexErrors: indexErrors.concat(separationErrors),
    example: example
  };
}

function validateDisasterSearchIndex(payload) {
  const errors = [];

  if (!payload || payload.version !== "1.0") {
    errors.push("version must be 1.0");
  }

  if (!payload || payload.region !== REGION_KYUSHU_SOUTH) {
    errors.push("region must be KYUSHU_SOUTH");
  }

  if (!payload || !Array.isArray(payload.index)) {
    errors.push("index must be an array");
    return errors;
  }

  const ids = new Set();

  payload.index.forEach(function (entry, index) {
    errors.push.apply(errors, validateDisasterSearchIndexEntry(entry, index));

    if (entry.index_id) {
      if (ids.has(entry.index_id)) {
        errors.push("duplicate index_id: " + entry.index_id);
      }
      ids.add(entry.index_id);
    }
  });

  if (!payload.index.length) {
    errors.push("index must not be empty");
  }

  return errors;
}

module.exports = {
  DISASTER_SOURCES_FILE,
  CROSS_VIEW_FILE,
  SNAPSHOT_FILE,
  SNAPSHOT_SEED_FILE,
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  REGION_KYUSHU_SOUTH,
  CATEGORIES,
  DISASTER_WATER_KEYWORDS,
  VOLUNTEER_KEYWORDS,
  CAPABILITY_STATUS,
  VOLUNTEER_DISASTER_START_DATE,
  buildDisasterSearchIndex,
  buildVolunteerRegistryItems,
  isVolunteerPublishedForCurrentDisaster,
  toVolunteerRegistryIndexEntry,
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex,
  normalizeSearchText,
  validateDisasterSearchIndex,
  validateDisasterSearchIndexEntry,
  validateVolunteerIndexExample,
  parseFacilitiesFromOriginalText
};
