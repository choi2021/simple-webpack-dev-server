"use strict";
const ChunkGraph = require("webpack/lib/ChunkGraph");
const NormalModule = require("webpack/lib/NormalModule");
const ImportMetaHotAcceptDependency = require("webpack/lib/dependencies/ImportMetaHotAcceptDependency");
const HotModuleReplacementRuntimeModule = require("./HotModuleReplacementRuntimeModule");
const {
  getRuntimeKey,
  keyToRuntime,
  forEachRuntime,
  mergeRuntimeOwned,
  subtractRuntime,
  intersectRuntime,
} = require("webpack/lib/util/runtime");

const { find, isSubset } = require("webpack/lib/util/SetHelpers");
const RuntimeGlobals = require("webpack/lib/RuntimeGlobals");
const TupleSet = require("webpack/lib/util/TupleSet");
const { compareModulesById } = require("webpack/lib/util/comparators");

const ConstDependency = require("webpack/lib/dependencies/ConstDependency");
const HotUpdateChunk = require("webpack/lib/Chunk");
const { SyncBailHook } = require("tapable");
const { RawSource } = require("webpack-sources");

const JavascriptParser = require("webpack/lib/javascript/JavascriptParser");
const {
  evaluateToIdentifier,
} = require("webpack/lib/javascript/JavascriptParserHelpers");

const parserHooksMap = new WeakMap();

const Compilation = {
  PROCESS_ASSETS_STAGE_ADDITIONAL: -2000,
};

const PLUGIN_NAME = "HotModuleReplacementPlugin";
const JAVASCRIPT_MODULE_TYPE_ESM = "javascript/esm";

class HotModuleReplacementPlugin {
  /**
   * @param {JavascriptParser} parser the parser
   * @returns {HMRJavascriptParserHooks} the attached hooks
   */
  static getParserHooks(parser) {
    let hooks = parserHooksMap.get(parser);
    if (hooks === undefined) {
      hooks = {
        hotAcceptCallback: new SyncBailHook(["expression", "requests"]),
        hotAcceptWithoutCallback: new SyncBailHook(["expression", "requests"]),
      };
      parserHooksMap.set(parser, hooks);
    }
    return hooks;
  }

  /**
   * @param {object=} options options
   */
  constructor(options) {
    this.options = options || {};
  }

  /**
   * Apply the plugin
   * @param {Compiler} compiler the compiler instance
   * @returns {void}
   */
  apply(compiler) {
    const { _backCompat: backCompat } = compiler;
    if (compiler.options.output.strictModuleErrorHandling === undefined)
      compiler.options.output.strictModuleErrorHandling = true;
    const runtimeRequirements = [RuntimeGlobals.module];

    /**
     * @param {JavascriptParser} parser the parser
     * @returns {(expr: Expression) => boolean | undefined} callback
     */
    const createHMRExpressionHandler = (parser) => (expr) => {
      const module = parser.state.module;
      const dep = new ConstDependency(
        `${module.moduleArgument}.hot`,
        expr.range,
        runtimeRequirements
      );
      dep.loc = expr.loc;
      module.addPresentationalDependency(dep);
      module.buildInfo.moduleConcatenationBailout = "Hot Module Replacement";
      return true;
    };

    const applyImportMetaHot = (parser) => {
      parser.hooks.evaluateIdentifier
        .for("import.meta.webpackHot")
        .tap(PLUGIN_NAME, (expr) =>
          evaluateToIdentifier(
            "import.meta.webpackHot",
            "import.meta",
            () => ["webpackHot"],
            true
          )(expr)
        );
      parser.hooks.call
        .for("import.meta.webpackHot.accept")
        .tap(
          PLUGIN_NAME,
          createAcceptHandler(parser, ImportMetaHotAcceptDependency)
        );
      parser.hooks.expression
        .for("import.meta.webpackHot")
        .tap(PLUGIN_NAME, createHMRExpressionHandler(parser));
    };

    compiler.hooks.compilation.tap(
      PLUGIN_NAME,
      (compilation, { normalModuleFactory }) => {
        if (compilation.compiler !== compiler) return;

        compilation.dependencyFactories.set(
          ImportMetaHotAcceptDependency,
          normalModuleFactory
        );
        compilation.dependencyTemplates.set(
          ImportMetaHotAcceptDependency,
          new ImportMetaHotAcceptDependency.Template()
        );

        let hotIndex = 0;
        const fullHashChunkModuleHashes = {};
        const chunkModuleHashes = {};

        compilation.hooks.record.tap(PLUGIN_NAME, (compilation, records) => {
          if (records.hash === compilation.hash) return;
          const chunkGraph = compilation.chunkGraph;
          records.hash = compilation.hash;
          records.hotIndex = hotIndex;
          records.fullHashChunkModuleHashes = fullHashChunkModuleHashes;
          records.chunkModuleHashes = chunkModuleHashes;
          records.chunkHashes = {};
          records.chunkRuntime = {};
          for (const chunk of compilation.chunks) {
            const chunkId = chunk.id;
            records.chunkHashes[chunkId] = chunk.hash;
            records.chunkRuntime[chunkId] = getRuntimeKey(chunk.runtime);
          }
          records.chunkModuleIds = {};
          for (const chunk of compilation.chunks) {
            records.chunkModuleIds[chunk.id] = Array.from(
              chunkGraph.getOrderedChunkModulesIterable(
                chunk,
                compareModulesById(chunkGraph)
              ),
              (m) => chunkGraph.getModuleId(m)
            );
          }
        });
        const updatedModules = new TupleSet();
        const fullHashModules = new TupleSet();
        const nonCodeGeneratedModules = new TupleSet();
        compilation.hooks.fullHash.tap(PLUGIN_NAME, (hash) => {
          const chunkGraph = compilation.chunkGraph;
          const records = /** @type {Records} */ (compilation.records);
          for (const chunk of compilation.chunks) {
            const getModuleHash = (module) => {
              if (
                compilation.codeGenerationResults.has(module, chunk.runtime)
              ) {
                return compilation.codeGenerationResults.getHash(
                  module,
                  chunk.runtime
                );
              }
              nonCodeGeneratedModules.add(module, chunk.runtime);
              return chunkGraph.getModuleHash(module, chunk.runtime);
            };
            const fullHashModulesInThisChunk =
              chunkGraph.getChunkFullHashModulesSet(chunk);
            if (fullHashModulesInThisChunk !== undefined) {
              for (const module of fullHashModulesInThisChunk) {
                fullHashModules.add(module, chunk);
              }
            }
            const modules = chunkGraph.getChunkModulesIterable(chunk);
            if (modules !== undefined) {
              if (records.chunkModuleHashes) {
                if (fullHashModulesInThisChunk !== undefined) {
                  for (const module of modules) {
                    const key = `${chunk.id}|${module.identifier()}`;
                    const hash = getModuleHash(module);
                    if (
                      fullHashModulesInThisChunk.has(
                        /** @type {RuntimeModule} */ (module)
                      )
                    ) {
                      if (records.fullHashChunkModuleHashes[key] !== hash) {
                        updatedModules.add(module, chunk);
                      }
                      fullHashChunkModuleHashes[key] = hash;
                    } else {
                      if (records.chunkModuleHashes[key] !== hash) {
                        updatedModules.add(module, chunk);
                      }
                      chunkModuleHashes[key] = hash;
                    }
                  }
                } else {
                  for (const module of modules) {
                    const key = `${chunk.id}|${module.identifier()}`;
                    const hash = getModuleHash(module);
                    if (records.chunkModuleHashes[key] !== hash) {
                      updatedModules.add(module, chunk);
                    }
                    chunkModuleHashes[key] = hash;
                  }
                }
              } else if (fullHashModulesInThisChunk !== undefined) {
                for (const module of modules) {
                  const key = `${chunk.id}|${module.identifier()}`;
                  const hash = getModuleHash(module);
                  if (
                    fullHashModulesInThisChunk.has(
                      /** @type {RuntimeModule} */ (module)
                    )
                  ) {
                    fullHashChunkModuleHashes[key] = hash;
                  } else {
                    chunkModuleHashes[key] = hash;
                  }
                }
              } else {
                for (const module of modules) {
                  const key = `${chunk.id}|${module.identifier()}`;
                  const hash = getModuleHash(module);
                  chunkModuleHashes[key] = hash;
                }
              }
            }
          }

          hotIndex = records.hotIndex || 0;
          if (updatedModules.size > 0) hotIndex++;

          hash.update(`${hotIndex}`);
        });
        compilation.hooks.processAssets.tap(
          {
            name: PLUGIN_NAME,
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            const chunkGraph = compilation.chunkGraph;
            const records = /** @type {Records} */ (compilation.records);
            if (records.hash === compilation.hash) return;
            if (
              !records.chunkModuleHashes ||
              !records.chunkHashes ||
              !records.chunkModuleIds
            ) {
              return;
            }
            for (const [module, chunk] of fullHashModules) {
              const key = `${chunk.id}|${module.identifier()}`;
              const hash = nonCodeGeneratedModules.has(module, chunk.runtime)
                ? chunkGraph.getModuleHash(module, chunk.runtime)
                : compilation.codeGenerationResults.getHash(
                    module,
                    chunk.runtime
                  );
              if (records.chunkModuleHashes[key] !== hash) {
                updatedModules.add(module, chunk);
              }
              chunkModuleHashes[key] = hash;
            }

            /** @type {HotUpdateMainContentByRuntime} */
            const hotUpdateMainContentByRuntime = new Map();
            let allOldRuntime;
            for (const key of Object.keys(records.chunkRuntime)) {
              const runtime = keyToRuntime(records.chunkRuntime[key]);
              allOldRuntime = mergeRuntimeOwned(allOldRuntime, runtime);
            }
            forEachRuntime(allOldRuntime, (runtime) => {
              const { path: filename, info: assetInfo } =
                compilation.getPathWithInfo(
                  /** @type {NonNullable<OutputNormalized["hotUpdateMainFilename"]>} */
                  (compilation.outputOptions.hotUpdateMainFilename),
                  {
                    hash: records.hash,
                    runtime,
                  }
                );
              hotUpdateMainContentByRuntime.set(
                /** @type {string} */ (runtime),
                {
                  updatedChunkIds: new Set(),
                  removedChunkIds: new Set(),
                  removedModules: new Set(),
                  filename,
                  assetInfo,
                }
              );
            });
            if (hotUpdateMainContentByRuntime.size === 0) return;

            // Create a list of all active modules to verify which modules are removed completely
            /** @type {Map<number|string, Module>} */
            const allModules = new Map();
            for (const module of compilation.modules) {
              const id =
                /** @type {ModuleId} */
                (chunkGraph.getModuleId(module));
              allModules.set(id, module);
            }

            // List of completely removed modules
            /** @type {Set<string | number>} */
            const completelyRemovedModules = new Set();

            for (const key of Object.keys(records.chunkHashes)) {
              const oldRuntime = keyToRuntime(records.chunkRuntime[key]);
              /** @type {Module[]} */
              const remainingModules = [];
              // Check which modules are removed
              for (const id of records.chunkModuleIds[key]) {
                const module = allModules.get(id);
                if (module === undefined) {
                  completelyRemovedModules.add(id);
                } else {
                  remainingModules.push(module);
                }
              }

              /** @type {ChunkId | null} */
              let chunkId;
              let newModules;
              let newRuntimeModules;
              let newFullHashModules;
              let newDependentHashModules;
              let newRuntime;
              let removedFromRuntime;
              const currentChunk = find(
                compilation.chunks,
                (chunk) => `${chunk.id}` === key
              );
              if (currentChunk) {
                chunkId = currentChunk.id;
                newRuntime = intersectRuntime(
                  currentChunk.runtime,
                  allOldRuntime
                );
                if (newRuntime === undefined) continue;
                newModules = chunkGraph
                  .getChunkModules(currentChunk)
                  .filter((module) => updatedModules.has(module, currentChunk));
                newRuntimeModules = Array.from(
                  chunkGraph.getChunkRuntimeModulesIterable(currentChunk)
                ).filter((module) => updatedModules.has(module, currentChunk));
                const fullHashModules =
                  chunkGraph.getChunkFullHashModulesIterable(currentChunk);
                newFullHashModules =
                  fullHashModules &&
                  Array.from(fullHashModules).filter((module) =>
                    updatedModules.has(module, currentChunk)
                  );
                const dependentHashModules =
                  chunkGraph.getChunkDependentHashModulesIterable(currentChunk);
                newDependentHashModules =
                  dependentHashModules &&
                  Array.from(dependentHashModules).filter((module) =>
                    updatedModules.has(module, currentChunk)
                  );
                removedFromRuntime = subtractRuntime(oldRuntime, newRuntime);
              } else {
                // chunk has completely removed
                chunkId = `${Number(key)}` === key ? Number(key) : key;
                removedFromRuntime = oldRuntime;
                newRuntime = oldRuntime;
              }
              if (removedFromRuntime) {
                // chunk was removed from some runtimes
                forEachRuntime(removedFromRuntime, (runtime) => {
                  const item =
                    /** @type {HotUpdateMainContentByRuntimeItem} */
                    (
                      hotUpdateMainContentByRuntime.get(
                        /** @type {string} */ (runtime)
                      )
                    );
                  item.removedChunkIds.add(/** @type {ChunkId} */ (chunkId));
                });
                // dispose modules from the chunk in these runtimes
                // where they are no longer in this runtime
                for (const module of remainingModules) {
                  const moduleKey = `${key}|${module.identifier()}`;
                  const oldHash = records.chunkModuleHashes[moduleKey];
                  const runtimes = chunkGraph.getModuleRuntimes(module);
                  if (oldRuntime === newRuntime && runtimes.has(newRuntime)) {
                    // Module is still in the same runtime combination
                    const hash = nonCodeGeneratedModules.has(module, newRuntime)
                      ? chunkGraph.getModuleHash(module, newRuntime)
                      : compilation.codeGenerationResults.getHash(
                          module,
                          newRuntime
                        );
                    if (hash !== oldHash) {
                      if (module.type === WEBPACK_MODULE_TYPE_RUNTIME) {
                        newRuntimeModules = newRuntimeModules || [];
                        newRuntimeModules.push(
                          /** @type {RuntimeModule} */ (module)
                        );
                      } else {
                        newModules = newModules || [];
                        newModules.push(module);
                      }
                    }
                  } else {
                    // module is no longer in this runtime combination
                    // We (incorrectly) assume that it's not in an overlapping runtime combination
                    // and dispose it from the main runtimes the chunk was removed from
                    forEachRuntime(removedFromRuntime, (runtime) => {
                      // If the module is still used in this runtime, do not dispose it
                      // This could create a bad runtime state where the module is still loaded,
                      // but no chunk which contains it. This means we don't receive further HMR updates
                      // to this module and that's bad.
                      // TODO force load one of the chunks which contains the module
                      for (const moduleRuntime of runtimes) {
                        if (typeof moduleRuntime === "string") {
                          if (moduleRuntime === runtime) return;
                        } else if (
                          moduleRuntime !== undefined &&
                          moduleRuntime.has(/** @type {string} */ (runtime))
                        )
                          return;
                      }
                      const item =
                        /** @type {HotUpdateMainContentByRuntimeItem} */ (
                          hotUpdateMainContentByRuntime.get(
                            /** @type {string} */ (runtime)
                          )
                        );
                      item.removedModules.add(module);
                    });
                  }
                }
              }
              if (
                (newModules && newModules.length > 0) ||
                (newRuntimeModules && newRuntimeModules.length > 0)
              ) {
                const hotUpdateChunk = new HotUpdateChunk();
                if (backCompat)
                  ChunkGraph.setChunkGraphForChunk(hotUpdateChunk, chunkGraph);
                hotUpdateChunk.id = chunkId;
                hotUpdateChunk.runtime = currentChunk
                  ? currentChunk.runtime
                  : newRuntime;
                if (currentChunk) {
                  for (const group of currentChunk.groupsIterable)
                    hotUpdateChunk.addGroup(group);
                }
                chunkGraph.attachModules(hotUpdateChunk, newModules || []);
                chunkGraph.attachRuntimeModules(
                  hotUpdateChunk,
                  newRuntimeModules || []
                );
                if (newFullHashModules) {
                  chunkGraph.attachFullHashModules(
                    hotUpdateChunk,
                    newFullHashModules
                  );
                }
                if (newDependentHashModules) {
                  chunkGraph.attachDependentHashModules(
                    hotUpdateChunk,
                    newDependentHashModules
                  );
                }
                const renderManifest = compilation.getRenderManifest({
                  chunk: hotUpdateChunk,
                  hash: records.hash,
                  fullHash: records.hash,
                  outputOptions: compilation.outputOptions,
                  moduleTemplates: compilation.moduleTemplates,
                  dependencyTemplates: compilation.dependencyTemplates,
                  codeGenerationResults: compilation.codeGenerationResults,
                  runtimeTemplate: compilation.runtimeTemplate,
                  moduleGraph: compilation.moduleGraph,
                  chunkGraph,
                });
                for (const entry of renderManifest) {
                  /** @type {string} */
                  let filename;
                  /** @type {AssetInfo} */
                  let assetInfo;
                  if ("filename" in entry) {
                    filename = entry.filename;
                    assetInfo = entry.info;
                  } else {
                    ({ path: filename, info: assetInfo } =
                      compilation.getPathWithInfo(
                        entry.filenameTemplate,
                        entry.pathOptions
                      ));
                  }
                  const source = entry.render();
                  compilation.additionalChunkAssets.push(filename);
                  compilation.emitAsset(filename, source, {
                    hotModuleReplacement: true,
                    ...assetInfo,
                  });
                  if (currentChunk) {
                    currentChunk.files.add(filename);
                    compilation.hooks.chunkAsset.call(currentChunk, filename);
                  }
                }
                forEachRuntime(newRuntime, (runtime) => {
                  const item =
                    /** @type {HotUpdateMainContentByRuntimeItem} */ (
                      hotUpdateMainContentByRuntime.get(
                        /** @type {string} */ (runtime)
                      )
                    );
                  item.updatedChunkIds.add(/** @type {ChunkId} */ (chunkId));
                });
              }
            }
            const completelyRemovedModulesArray = Array.from(
              completelyRemovedModules
            );
            const hotUpdateMainContentByFilename = new Map();
            for (const {
              removedChunkIds,
              removedModules,
              updatedChunkIds,
              filename,
              assetInfo,
            } of hotUpdateMainContentByRuntime.values()) {
              const old = hotUpdateMainContentByFilename.get(filename);
              if (
                old &&
                (!isSubset(old.removedChunkIds, removedChunkIds) ||
                  !isSubset(old.removedModules, removedModules) ||
                  !isSubset(old.updatedChunkIds, updatedChunkIds))
              ) {
                for (const chunkId of removedChunkIds)
                  old.removedChunkIds.add(chunkId);
                for (const chunkId of removedModules)
                  old.removedModules.add(chunkId);
                for (const chunkId of updatedChunkIds)
                  old.updatedChunkIds.add(chunkId);
                continue;
              }
              hotUpdateMainContentByFilename.set(filename, {
                removedChunkIds,
                removedModules,
                updatedChunkIds,
                assetInfo,
              });
            }
            for (const [
              filename,
              { removedChunkIds, removedModules, updatedChunkIds, assetInfo },
            ] of hotUpdateMainContentByFilename) {
              const hotUpdateMainJson = {
                c: Array.from(updatedChunkIds),
                r: Array.from(removedChunkIds),
                m:
                  removedModules.size === 0
                    ? completelyRemovedModulesArray
                    : completelyRemovedModulesArray.concat(
                        Array.from(
                          removedModules,
                          (m) =>
                            /** @type {ModuleId} */ (chunkGraph.getModuleId(m))
                        )
                      ),
              };

              const source = new RawSource(JSON.stringify(hotUpdateMainJson));
              compilation.emitAsset(filename, source, {
                hotModuleReplacement: true,
                ...assetInfo,
              });
            }
          }
        );

        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          PLUGIN_NAME,
          (chunk, runtimeRequirements) => {
            runtimeRequirements.add(RuntimeGlobals.hmrDownloadManifest);
            runtimeRequirements.add(RuntimeGlobals.hmrDownloadUpdateHandlers);
            runtimeRequirements.add(RuntimeGlobals.interceptModuleExecution);
            runtimeRequirements.add(RuntimeGlobals.moduleCache);
            compilation.addRuntimeModule(
              chunk,
              new HotModuleReplacementRuntimeModule()
            );
          }
        );
        normalModuleFactory.hooks.parser
          .for(JAVASCRIPT_MODULE_TYPE_ESM)
          .tap(PLUGIN_NAME, (parser) => {
            applyImportMetaHot(parser);
          });
        normalModuleFactory.hooks.module.tap(PLUGIN_NAME, (module) => {
          module.hot = true;
          return module;
        });

        NormalModule.getCompilationHooks(compilation).loader.tap(
          PLUGIN_NAME,
          (context) => {
            context.hot = true;
          }
        );
      }
    );
  }
}

module.exports = HotModuleReplacementPlugin;
