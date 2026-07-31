"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const PUBLIC_BUILD_OUTPUTS = [
  "data/public/water_cross_view.json",
  "data/public/water_search_index.json",
  "data/public/disaster_search_index.json"
];

function runPublicDataBuild(options) {
  options = options || {};
  execSync("npm run build", {
    cwd: ROOT,
    stdio: options.inherit ? "inherit" : "pipe",
    encoding: "utf8"
  });
}

module.exports = {
  PUBLIC_BUILD_OUTPUTS,
  runPublicDataBuild
};
