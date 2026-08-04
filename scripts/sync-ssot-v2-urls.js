#!/usr/bin/env node
"use strict";

/**
 * SSOT v2: sync municipality disaster page URLs into disaster_sources.json and water_sources.json
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TOP_FILE = path.join(
  ROOT,
  "data",
  "municipality_patrol",
  "municipality_top_page_sources.json"
);
const DISASTER_FILE = path.join(ROOT, "data", "disaster_sources.json");
const WATER_FILE = path.join(ROOT, "data", "water_sources.json");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");

const SSOT_V2_URLS = {
  熊本市: "https://www.city.kumamoto.jp/bousai/",
  八代市: "https://www.city.yatsushiro.lg.jp/bousai/default.html",
  水俣市: "https://www.city.minamata.lg.jp/bousai/kiji003257/index.html",
  宇土市: "https://www.city.uto.lg.jp/article/list/1014.html",
  上天草市: "https://www.city.kamiamakusa.kumamoto.jp/q/list/542.html",
  宇城市: "https://www.city.uki.kumamoto.jp/kinkyu/2606699",
  天草市: "https://www.city.amakusa.kumamoto.jp/bousai/default.html",
  美里町: "https://www.town.kumamoto-misato.lg.jp/",
  甲佐町: "https://www.town.kosa.lg.jp/list00171.html",
  芦北町: "https://www.town.ashikita.lg.jp/bosai_site",
  津奈木町: "https://www.town.tsunagi.lg.jp/kinkyu/pub/default.aspx?c_id=9",
  苓北町: "https://reihoku-kumamoto.jp/bousai/default.html",
  益城町: "https://www.town.mashiki.lg.jp/bousai",
  御船町: "https://www.town.mifune.kumamoto.jp/kinkyu/pub/default.aspx?c_id=8",
  嘉島町: "https://www.town.kashima.kumamoto.jp/bousai/",
  人吉市: "https://www.city.hitoyoshi.lg.jp/disaster_mode/saigai_kinkyujyoho/2500294",
  菊陽町: "https://www.town.kikuyo.lg.jp/bousai",
  菊池市: "https://www.city.kikuchi.lg.jp/",
  合志市: "https://www.city.koshi.lg.jp/kiji00318536/index.html",
  氷川町: "https://www.town.hikawa.kumamoto.jp/",
  阿蘇市: "https://www.city.aso.kumamoto.jp/",
  南阿蘇村: "https://www.vill.minamiaso.lg.jp/site/bousai/",
  西原村: "https://www.vill.nishihara.kumamoto.jp/bousai/default.html",
  多良木町: "http://www.town.taragi.lg.jp/cgi-bin/smart_alert.php/1/list"
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function updateDisasterSources(disaster) {
  let updated = 0;
  (disaster.sources || []).forEach(function (entry) {
    if (entry.source_type !== "MUNICIPALITY" || entry.prefecture !== "熊本県") {
      return;
    }
    const url = SSOT_V2_URLS[entry.municipality];
    if (url && entry.url !== url) {
      entry.url = url;
      updated += 1;
    }
  });

  // Add missing municipalities
  const existing = new Set(
    (disaster.sources || [])
      .filter(function (e) {
        return e.source_type === "MUNICIPALITY" && e.prefecture === "熊本県";
      })
      .map(function (e) {
        return e.municipality;
      })
  );

  Object.keys(SSOT_V2_URLS).forEach(function (name) {
    if (existing.has(name)) {
      return;
    }
    disaster.sources.push({
      source_id: "DSRC-WAT-" + name.replace(/\s/g, ""),
      category: "WATER",
      prefecture: "熊本県",
      municipality: name,
      organization: name,
      source_type: "MUNICIPALITY",
      url: SSOT_V2_URLS[name],
      keywords: [
        "給水",
        "応急給水",
        "給水所",
        "給水車",
        "断水",
        "水道",
        "復旧"
      ],
      extractor: {},
      official: true,
      active: true
    });
    updated += 1;
  });

  return updated;
}

function updateWaterSources(water) {
  let updated = 0;
  (water.sources || []).forEach(function (entry) {
    if (entry.region !== "熊本県") {
      return;
    }
    const url = SSOT_V2_URLS[entry.organization];
    if (url && entry.url !== url) {
      entry.url = url;
      updated += 1;
    }
  });

  Object.keys(SSOT_V2_URLS).forEach(function (name) {
    const found = (water.sources || []).some(function (e) {
      return e.organization === name && e.region === "熊本県";
    });
    if (!found) {
      water.sources.push({
        region: "熊本県",
        organization: name,
        source_type: "official",
        url: SSOT_V2_URLS[name],
        keywords: [
          "給水",
          "応急給水",
          "給水所",
          "給水車",
          "断水",
          "水道",
          "復旧"
        ],
        official: true
      });
      updated += 1;
    }
  });

  return updated;
}

function updateSourcesJson(sources) {
  let updated = 0;
  const top = readJson(TOP_FILE);
  const disasterMap = {};
  (top.municipalities || []).forEach(function (m) {
    if (m.disaster_page_url) {
      disasterMap[m.municipality] = m.disaster_page_url;
    }
  });

  (sources.municipalities || []).forEach(function (entry) {
    if (entry.patrol_role !== "primary" || entry.public_category_id !== "EMERGENCY") {
      return;
    }
    const name = entry.name;
    const url = disasterMap[name] || SSOT_V2_URLS[name];
    if (url && normalizeUrl(entry.url) !== normalizeUrl(url)) {
      entry.url = url;
      updated += 1;
    }
  });

  return updated;
}

const disaster = readJson(DISASTER_FILE);
const water = readJson(WATER_FILE);
const sources = readJson(SOURCES_FILE);

const counts = {
  disaster_sources: updateDisasterSources(disaster),
  water_sources: updateWaterSources(water),
  monitor_sources: updateSourcesJson(sources)
};

writeJson(DISASTER_FILE, disaster);
writeJson(WATER_FILE, water);
writeJson(SOURCES_FILE, sources);

console.log(JSON.stringify({ SSOT_V2_SYNC: "OK", updated: counts }, null, 2));
