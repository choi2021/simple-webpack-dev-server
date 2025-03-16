"use strict";

const webpack = require("webpack");
const RuntimeGlobals = require("webpack/lib/RuntimeGlobals");
const RuntimeModule = require("webpack/lib/RuntimeModule");
const Template = require("webpack/lib/Template");
const runtime = require("webpack/lib/hmr/HotModuleReplacement.runtime.js");

class HotModuleReplacementRuntimeModule extends RuntimeModule {
  constructor() {
    super("hot module replacement", RuntimeModule.STAGE_BASIC);
  }

  /**
   * @returns {string | null} runtime code
   */
  generate() {
    return Template.getFunctionContent(runtime)
      .replace(
        /\$interceptModuleExecution\$/g,
        RuntimeGlobals.interceptModuleExecution
      )
      .replace(/\$moduleCache\$/g, RuntimeGlobals.moduleCache)
      .replace(/\$hmrModuleData\$/g, RuntimeGlobals.hmrModuleData)
      .replace(/\$hmrDownloadManifest\$/g, RuntimeGlobals.hmrDownloadManifest)
      .replace(
        /\$hmrInvalidateModuleHandlers\$/g,
        RuntimeGlobals.hmrInvalidateModuleHandlers
      )
      .replace(
        /\$hmrDownloadUpdateHandlers\$/g,
        RuntimeGlobals.hmrDownloadUpdateHandlers
      );
  }
}

module.exports = HotModuleReplacementRuntimeModule;
