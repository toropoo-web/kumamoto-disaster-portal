"use strict";

const SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS = {
  FREE_OPEN: "無料開放",
  BATH: "入浴・シャワー",
  SHOWER: "入浴・シャワー",
  SPACE: "休憩スペース",
  TOILET: "トイレ",
  VEHICLE: "車中泊・駐車場",
  FOOD: "食事・炊き出し",
  WATER_SUPPORT: "給水・飲料水",
  SUPPLIES: "支援物資",
  PET: "ペット支援"
};

const SUPPORT_SERVICE_SEARCH_DICTIONARY = {
  BATH: [
    "風呂",
    "お風呂",
    "入浴",
    "シャワー",
    "温泉",
    "銭湯",
    "入浴施設",
    "浴場",
    "シャワー室",
    "体を洗える",
    "無料風呂",
    "風呂無料",
    "無料入浴",
    "入浴支援",
    "無料シャワー",
    "シャワー無料",
    "温泉開放"
  ],
  SHOWER: [
    "シャワー",
    "シャワー室",
    "入浴",
    "風呂",
    "お風呂",
    "無料シャワー",
    "シャワー無料",
    "体を洗える"
  ],
  SPACE: [
    "休憩",
    "スペース",
    "場所",
    "個室",
    "部屋",
    "待機場所",
    "休憩場所",
    "休憩スペース",
    "仮眠",
    "宿泊スペース",
    "個室提供",
    "部屋提供"
  ],
  TOILET: [
    "トイレ",
    "仮設トイレ",
    "トイレ開放",
    "お手洗い",
    "化粧室",
    "水洗",
    "水洗トイレ"
  ],
  VEHICLE: [
    "車中泊",
    "車中泊できます",
    "車中泊可能",
    "車で泊まる",
    "駐車場",
    "駐車場開放",
    "駐車場提供",
    "無料駐車場",
    "車両受入",
    "車両",
    "キャンピングカー",
    "車",
    "車を停められる"
  ],
  FOOD: [
    "炊き出し",
    "炊き出しします",
    "食事",
    "食事提供",
    "食事提供します",
    "食料提供",
    "給食",
    "弁当配布",
    "無料食事"
  ],
  WATER_SUPPORT: [
    "井戸水",
    "井戸水あります",
    "水提供",
    "水提供します",
    "飲料水提供",
    "生活用水",
    "水配布",
    "飲料水",
    "給水",
    "地下水"
  ],
  SUPPLIES: [
    "支援物資",
    "物資",
    "配布",
    "物資配布",
    "物資配布します",
    "生活用品",
    "生活用品配布",
    "日用品",
    "日用品配布",
    "衣類配布",
    "毛布配布"
  ],
  PET: [
    "ペット",
    "犬",
    "猫",
    "動物",
    "ペット受入",
    "ペット対応",
    "ペット預かり"
  ],
  FREE_OPEN: ["無料開放", "無料", "開放"]
};

const SUPPORT_SERVICE_STATUS_LABELS = {
  ACTIVE: "利用可能情報",
  UNKNOWN: "期間不明",
  EXPIRED: "終了情報"
};

const SUPPORT_SERVICE_USER_SEARCH_CAUTION =
  "掲載情報は情報提供元の発信内容をもとに整理しています。" +
  "利用条件・提供状況は変更される場合があります。" +
  "最新状況は情報提供元をご確認ください。";

function getSupportServiceDictionaryKeywords(subcategory, subcategoryDetail, openingType) {
  const keywords = [];
  const seen = {};

  function addKeyword(value) {
    if (!value || seen[value]) {
      return;
    }
    seen[value] = true;
    keywords.push(value);
  }

  (SUPPORT_SERVICE_SEARCH_DICTIONARY[subcategory] || []).forEach(addKeyword);
  if (subcategoryDetail) {
    (SUPPORT_SERVICE_SEARCH_DICTIONARY[subcategoryDetail] || []).forEach(addKeyword);
  }
  if (openingType === "FREE_OPEN") {
    (SUPPORT_SERVICE_SEARCH_DICTIONARY.FREE_OPEN || []).forEach(addKeyword);
  }

  return keywords;
}

function getSupportServiceDisplayCategoryLabel(subcategory, subcategoryDetail, openingType) {
  if (openingType === "FREE_OPEN") {
    return SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS.FREE_OPEN;
  }
  if (subcategoryDetail && SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS[subcategoryDetail]) {
    return SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS[subcategoryDetail];
  }
  return SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS[subcategory] || subcategory || "";
}

function getSupportServiceStatusLabel(status) {
  return SUPPORT_SERVICE_STATUS_LABELS[status] || status || SUPPORT_SERVICE_STATUS_LABELS.UNKNOWN;
}

function buildSupportServiceRegionHaystack(item) {
  return [item.prefecture, item.municipality, item.address, item.area]
    .filter(Boolean)
    .join(" ");
}

function matchesSupportServiceRegion(item, regionQuery) {
  if (!regionQuery) {
    return true;
  }
  const hay = String(buildSupportServiceRegionHaystack(item))
    .toLowerCase()
    .replace(/\u3000/g, " ");
  const token = String(regionQuery)
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .trim();
  if (!token) {
    return true;
  }
  return hay.indexOf(token) !== -1;
}

function buildSupportServiceSearchHaystack(item, normalizeSearchText) {
  const dictionaryKeywords = getSupportServiceDictionaryKeywords(
    item.subcategory,
    item.subcategory_detail,
    item.opening_type
  );

  return normalizeSearchText(
    [
      item.prefecture,
      item.municipality,
      item.address,
      item.area,
      item.organization,
      item.title,
      (item.keywords || []).join(" "),
      (item.detected_keywords || []).join(" "),
      item.content,
      item.subcategory,
      item.subcategory_detail,
      item.opening_type,
      item.facility_name,
      item.information_status,
      item.published_at,
      item.available_from,
      item.available_until,
      getSupportServiceDisplayCategoryLabel(
        item.subcategory,
        item.subcategory_detail,
        item.opening_type
      ),
      getSupportServiceStatusLabel(item.information_status),
      dictionaryKeywords.join(" ")
    ].join(" ")
  );
}

module.exports = {
  SUPPORT_SERVICE_DISPLAY_CATEGORY_LABELS,
  SUPPORT_SERVICE_SEARCH_DICTIONARY,
  SUPPORT_SERVICE_STATUS_LABELS,
  SUPPORT_SERVICE_USER_SEARCH_CAUTION,
  getSupportServiceDictionaryKeywords,
  getSupportServiceDisplayCategoryLabel,
  getSupportServiceStatusLabel,
  buildSupportServiceRegionHaystack,
  matchesSupportServiceRegion,
  buildSupportServiceSearchHaystack
};
