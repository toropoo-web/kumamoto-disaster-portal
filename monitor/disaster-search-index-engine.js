"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  REGION_KYUSHU_SOUTH,
  PREFECTURES,
  CATEGORIES,
  WATER_KEYWORDS,
  resolveMunicipality,
  validateVolunteerSchemaExample
} = require("./disaster-sources");

const ROOT = path.join(__dirname, "..");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");
const CROSS_VIEW_FILE = path.join(ROOT, "data", "water_cross_view.json");
const SNAPSHOT_FILE = path.join(__dirname, "reports", "water-snapshots.json");
const SNAPSHOT_SEED_FILE = path.join(__dirname, "baselines", "water-snapshots.seed.json");
const OUTPUT_FILE = path.join(ROOT, "data", "disaster_search_index.json");

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
  const index = dedupeIndexItems(locationItems.concat(registryItems, snapshotItems));

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    index: index,
    meta: {
      location_item_count: locationItems.length,
      registry_item_count: registryItems.length,
      snapshot_item_count: snapshotItems.length,
      item_count: index.length,
      last_updated: new Date().toISOString()
    }
  };
}

function buildAndWriteDisasterSearchIndex(options) {
  const payload = buildDisasterSearchIndex(options);
  writeJson(options && options.outputPath ? options.outputPath : OUTPUT_FILE, {
    version: payload.version,
    region: payload.region,
    index: payload.index
  });
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
        item.content
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

  return errors;
}

function validateVolunteerIndexExample() {
  const example = {
    index_id: buildIndexId(["VOLUNTEER", "example", "社会福祉協議会"]),
    category: "VOLUNTEER",
    prefecture: "熊本県",
    municipality: "熊本県",
    organization: "社会福祉協議会",
    title: "災害ボランティア募集",
    content: "熊本県 社会福祉協議会 災害ボランティア 募集 受付",
    keywords: ["災害ボランティア", "募集", "受付"],
    source_type: "SOCIAL_WELFARE",
    source_url: "https://example.invalid/volunteer-placeholder",
    official: true,
    updated_at: null
  };

  const schemaErrors = validateVolunteerSchemaExample();
  const indexErrors = validateDisasterSearchIndexEntry(example, 0);

  return {
    schemaErrors: schemaErrors,
    indexErrors: indexErrors,
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
  REGION_KYUSHU_SOUTH,
  CATEGORIES,
  DISASTER_WATER_KEYWORDS,
  buildDisasterSearchIndex,
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex,
  normalizeSearchText,
  validateDisasterSearchIndex,
  validateDisasterSearchIndexEntry,
  validateVolunteerIndexExample,
  parseFacilitiesFromOriginalText
};
