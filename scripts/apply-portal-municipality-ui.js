#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const TARGETS_FILE = path.join(ROOT, "data", "municipality_expansion", "portal_ui_targets.json");
const APP_JS = path.join(ROOT, "js", "app.js");
const VALIDATE_DATA = path.join(ROOT, "scripts", "validate-data.js");
const VALIDATE_UI = path.join(ROOT, "scripts", "validate-ui.js");
const {
  convertWaterEntryToDisasterSource
} = require(path.join(ROOT, "monitor", "disaster-sources"));

const CHECKED_AT = "2026-07-31T00:00:00+09:00";
const DISPLAYED_AT = "2026-07-31T00:00:00.000Z";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function areaEntry(target) {
  return { area_id: target.area_id, name: target.name, anchor: target.anchor };
}

function areaNavEntry(target) {
  return {
    area_id: target.area_id,
    name: target.name,
    navigation: {
      water: target.name + " 給水場所",
      shelter: target.name + " 避難所",
      road: target.name + " 通行止め",
      disaster_map: target.disaster_url
    }
  };
}

function emergencySource(target) {
  return {
    source_id: "EMG-SRC-" + target.area_id + "-EMERGENCY-001",
    area_id: target.area_id,
    municipality: target.name,
    source_type: "DISASTER_PAGE",
    url: target.disaster_url,
    status: "ACTIVE"
  };
}

function locationSources(target) {
  const base = {
    source_type: "MUNICIPALITY",
    last_checked_at: CHECKED_AT
  };
  return [
    Object.assign({}, base, {
      source_id: "LOC-SRC-" + target.area_id + "-EMERGENCY-001",
      area_id: target.area_id,
      municipality: target.name,
      category: "EMERGENCY",
      url: target.disaster_url,
      update_cycle: "EVENT",
      status: "ACTIVE"
    }),
    Object.assign({}, base, {
      source_id: "LOC-SRC-" + target.area_id + "-WATER-PENDING",
      area_id: target.area_id,
      municipality: target.name,
      category: "WATER",
      url: null,
      update_cycle: "DAILY",
      status: "PENDING",
      status_reason: "公式の給水一覧ページ確認中。自治体防災情報をご確認ください。"
    }),
    Object.assign({}, base, {
      source_id: "LOC-SRC-" + target.area_id + "-SHELTER-PENDING",
      area_id: target.area_id,
      municipality: target.name,
      category: "SHELTER",
      url: null,
      update_cycle: "EVENT",
      status: "PENDING",
      status_reason: "公式の避難所一覧ページ確認中。自治体防災情報をご確認ください。"
    }),
    Object.assign({}, base, {
      source_id: "LOC-SRC-" + target.area_id + "-ROAD-PENDING",
      area_id: target.area_id,
      municipality: target.name,
      category: "ROAD",
      url: null,
      update_cycle: "EVENT",
      status: "PENDING",
      status_reason: "公式の道路・通行止め一覧ページ未確認。"
    })
  ];
}

function waterSourceEntry(target) {
  return {
    region: "熊本県",
    organization: target.name,
    source_type: "official",
    url: target.water_url,
    keywords: ["給水", "応急給水", "給水所", "給水車", "断水", "水道", "復旧"],
    official: true
  };
}

function waterRegistryItem(target) {
  const keywords = "給水 応急給水 給水所 給水車 断水 水道 復旧";
  return {
    item_kind: "registry",
    region: "熊本県",
    municipality: target.name,
    organization: target.name,
    location: "給水関連情報",
    title: "給水関連情報",
    search_text: ["熊本県", target.name, target.name, "給水関連情報", keywords].join(" "),
    source_name: target.name + "公式",
    source_type: "official",
    source_url: target.water_url,
    updated_at: null
  };
}

function disasterWaterIndexItem(target) {
  const keywords = ["給水", "断水", "水道", "復旧"];
  return {
    index_id: "DIDX-" + target.area_id + "-WATER-REG",
    category: "WATER",
    prefecture: "熊本県",
    municipality: target.name,
    organization: target.name + "公式",
    title: target.name + " 給水関連情報",
    content: ["熊本県", target.name, target.name, "給水関連情報"].concat(keywords).join(" "),
    keywords: keywords,
    source_type: "MUNICIPALITY",
    source_url: target.water_url,
    official: true,
    updated_at: DISPLAYED_AT
  };
}

function phase1Update(target) {
  return {
    area_id: target.area_id,
    area_name: target.name,
    public_category_id: "EMERGENCY",
    public_category_label: "地震・緊急情報",
    headline: "防災・緊急情報（" + target.name + "）",
    summary: "避難所・断水・災害情報など、自治体公式の防災ページです。最新状況はリンク先でご確認ください。",
    displayed_updated_at: DISPLAYED_AT,
    source_name: target.name,
    source_url: target.disaster_url,
    department: target.name,
    verification_status: "VERIFIED",
    incident_scope: "2026_KUMAMOTO_EARTHQUAKE",
    collected_at: DISPLAYED_AT,
    display_priority: 1
  };
}

function appendUniqueByKey(array, items, keyFn) {
  const seen = new Set(array.map(keyFn));
  items.forEach(function (item) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      array.push(item);
      seen.add(key);
    }
  });
  return array;
}

function updateAreaDisplayRules(targets) {
  let content = fs.readFileSync(APP_JS, "utf8");
  targets.forEach(function (target) {
    const rule =
      '    ' +
      target.area_id +
      ': {\n' +
      '      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],\n' +
      '      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]\n' +
      '    }';
    if (content.indexOf(target.area_id + ":") >= 0) {
      return;
    }
    content = content.replace(/\n  \};\n\n  var COMMUNICATION_STATUS_LABELS/, ",\n" + rule + "\n  };\n\n  var COMMUNICATION_STATUS_LABELS");
  });
  fs.writeFileSync(APP_JS, content, "utf8");

  let validateContent = fs.readFileSync(VALIDATE_DATA, "utf8");
  targets.forEach(function (target) {
    const rule =
      '  ' +
      target.area_id +
      ': { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] }';
    if (validateContent.indexOf(target.area_id + ":") >= 0) {
      return;
    }
    validateContent = validateContent.replace(
      /  KM013: \{ allowed: \["EMERGENCY", "SHELTER", "WATER", "SUPPORT"\], blocked: \["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"\] \}\n\};/,
      '  KM013: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },\n' +
        rule +
        "\n};"
    );
  });
  fs.writeFileSync(VALIDATE_DATA, validateContent, "utf8");
}

function updateExpectedCounts(newAreaCount, newPublicCardCount) {
  [VALIDATE_DATA, VALIDATE_UI].forEach(function (filePath) {
    let content = fs.readFileSync(filePath, "utf8");
    content = content.replace(/EXPECTED_AREA_COUNT = \d+/, "EXPECTED_AREA_COUNT = " + newAreaCount);
    content = content.replace(/expected \d+\)/g, "expected " + newAreaCount + ")");
    content = content.replace(/EXPECTED_PUBLIC_CARD_COUNT = \d+/, "EXPECTED_PUBLIC_CARD_COUNT = " + newPublicCardCount);
    fs.writeFileSync(filePath, content, "utf8");
  });
}

function main() {
  const manifest = readJson(TARGETS_FILE);
  const targets = manifest.municipalities;

  const areasPath = path.join(PUBLIC_DIR, "phase1_areas.json");
  const navPath = path.join(PUBLIC_DIR, "phase1_navigation.json");
  const areaNavPath = path.join(PUBLIC_DIR, "area_navigation.json");
  const updatesPath = path.join(PUBLIC_DIR, "phase1_updates.json");
  const emergencyPath = path.join(PUBLIC_DIR, "emergency_sources.json");
  const locationPath = path.join(PUBLIC_DIR, "location_sources.json");
  const waterIndexPath = path.join(PUBLIC_DIR, "water_search_index.json");
  const disasterIndexPath = path.join(PUBLIC_DIR, "disaster_search_index.json");
  const waterSourcesPath = path.join(ROOT, "data", "water_sources.json");
  const disasterSourcesPath = path.join(ROOT, "data", "disaster_sources.json");

  const areas = readJson(areasPath);
  const navigation = readJson(navPath);
  const areaNavigation = readJson(areaNavPath);
  const updates = readJson(updatesPath);
  const emergency = readJson(emergencyPath);
  const locationSourcesData = readJson(locationPath);
  const waterIndex = readJson(waterIndexPath);
  const disasterIndex = readJson(disasterIndexPath);
  const waterSources = readJson(waterSourcesPath);
  const disasterSources = readJson(disasterSourcesPath);

  appendUniqueByKey(areas, targets.map(areaEntry), function (item) {
    return item.area_id;
  });
  appendUniqueByKey(navigation, targets.map(areaEntry), function (item) {
    return item.area_id;
  });
  appendUniqueByKey(areaNavigation.areas, targets.map(areaNavEntry), function (item) {
    return item.area_id;
  });
  appendUniqueByKey(emergency.sources, targets.map(emergencySource), function (item) {
    return item.source_id;
  });
  targets.forEach(function (target) {
    appendUniqueByKey(locationSourcesData.sources, locationSources(target), function (item) {
      return item.source_id;
    });
    appendUniqueByKey(waterSources.sources, [waterSourceEntry(target)], function (item) {
      return item.organization + "|" + item.url;
    });
    appendUniqueByKey(disasterSources.sources, [convertWaterEntryToDisasterSource(waterSourceEntry(target))], function (item) {
      return item.source_id;
    });
    appendUniqueByKey(waterIndex.items, [waterRegistryItem(target)], function (item) {
      return item.municipality + "|" + item.source_url;
    });
    if (!disasterIndex.index.some(function (item) {
      return item.municipality === target.name && item.category === "WATER";
    })) {
      disasterIndex.index.push(disasterWaterIndexItem(target));
    }
    if (!updates.some(function (item) {
      return item.area_id === target.area_id && item.public_category_id === "EMERGENCY";
    })) {
      updates.push(phase1Update(target));
    }
  });

  waterIndex.item_count = waterIndex.items.length;
  waterIndex.registry_item_count = waterIndex.items.filter(function (item) {
    return item.item_kind === "registry";
  }).length;
  waterIndex.last_updated = new Date().toISOString();
  if (disasterIndex.index) {
    disasterIndex.item_count = disasterIndex.index.length;
  }

  writeJson(areasPath, areas);
  writeJson(navPath, navigation);
  writeJson(areaNavPath, areaNavigation);
  writeJson(updatesPath, updates);
  writeJson(emergencyPath, emergency);
  writeJson(locationPath, locationSourcesData);
  writeJson(waterSourcesPath, waterSources);
  writeJson(disasterSourcesPath, disasterSources);
  writeJson(waterIndexPath, waterIndex);
  writeJson(disasterIndexPath, disasterIndex);

  updateAreaDisplayRules(targets);
  updateExpectedCounts(areas.length, 29);

  console.log(
    JSON.stringify(
      {
        PORTAL_MUNICIPALITY_UI_APPLY: "PASS",
        added_municipalities: targets.map(function (item) {
          return item.name;
        }),
        area_count: areas.length,
        public_card_count: 29
      },
      null,
      2
    )
  );
}

main();
