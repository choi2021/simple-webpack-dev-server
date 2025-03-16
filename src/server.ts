import express from "express";
import webpack, { MultiStats, Stats, StatsCompilation } from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import * as WebSocket from "ws";
import * as chokidar from "chokidar";
import http from "http";

// 1. 웹팩 설정 및 컴파일러
const config = require("../webpack.config.js");
const compiler = webpack(config);

const DEFAULT_STATS = {
  all: false,
  hash: true,
  warnings: true,
  errors: true,
  errorDetails: false,
};

class DevServer {
  private webSocketClients: WebSocket[] = [];
  private webSocketServer: WebSocket.Server | null = null;
  private watcher: chokidar.FSWatcher | null = null;
  private compiler: webpack.Compiler;
  private options: any;
  private server: http.Server;
  private stats: Stats | MultiStats | null = null;
  private currentHash?: string;

  constructor(compiler: webpack.Compiler, options: any) {
    this.compiler = compiler;
    this.options = options;
    this.currentHash = undefined;

    this.setupHooks();

    const app = express();
    this.server = http.createServer(app);
    this.createWebSocketServer();
    this.addAdditionalEntries(this.compiler);

    new webpack.ProvidePlugin({
      __webpack_dev_server_client__: this.getClientTransport(),
    }).apply(compiler);

    new webpack.HotModuleReplacementPlugin().apply(this.compiler);
    this.setupWatchFiles();

    app.use(webpackDevMiddleware(this.compiler));
  }

  getClientTransport() {
    return require.resolve("./client/clients/WebSocketClient");
  }

  watchFiles(watchPath: string, watchOptions: any) {
    const watcher = chokidar.watch(watchPath, watchOptions);

    watcher.on("change", (item) => {
      console.log(`파일 변경 감지: ${item}`);
      if (this.webSocketServer) {
        this.sendMessage(this.webSocketClients, "invalid");
      }
    });

    this.watcher = watcher;
  }
  createWebSocketServer() {
    if (!this.webSocketServer) {
      this.webSocketServer = new WebSocket.Server({ server: this.server });

      this.webSocketServer.on("connection", (ws) => {
        this.webSocketClients.push(ws as WebSocket);

        // 연결된 클라이언트에게 현재 상태 전송
        if (this.stats) {
          this.sendStats([ws as WebSocket], this.getStats(this.stats));
        }

        // 클라이언트와 연결 종료 시 정리
        ws.on("close", () => {
          const index = this.webSocketClients.indexOf(ws as WebSocket);
          if (index !== -1) {
            this.webSocketClients.splice(index, 1);
          }
        });
      });
    }
  }

  setupHooks(): void {
    this.compiler.hooks.invalid.tap("webpack-dev-server", () => {
      if (this.webSocketServer) {
        this.sendMessage(this.webSocketClients, "invalid");
      }
    });
    this.compiler.hooks.done.tap(
      "webpack-dev-server",
      /**
       * @param {Stats | MultiStats} stats
       */
      (stats) => {
        if (this.webSocketServer) {
          this.sendStats(this.webSocketClients, this.getStats(stats));
        }

        /**
         * @private
         * @type {Stats | MultiStats}
         */
        this.stats = stats;
      }
    );
  }

  getStats(statsObj: Stats | MultiStats) {
    const stats = DEFAULT_STATS;

    return statsObj.toJson(stats);
  }

  sendStats(clients: WebSocket[], stats: StatsCompilation): void {
    console.log("sendStats 호출됨, 클라이언트:", stats);

    const shouldEmit =
      stats &&
      (!stats.errors || stats.errors.length === 0) &&
      (!stats.warnings || stats.warnings.length === 0) &&
      this.currentHash === stats.hash;

    if (shouldEmit) {
      this.sendMessage(clients, "still-ok");

      return;
    }

    // 현재 해시 저장
    this.currentHash = stats.hash;
    this.sendMessage(clients, "hash", stats.hash);

    const errors = stats.errors as NonNullable<StatsCompilation["errors"]>;
    const warnings = stats.warnings as NonNullable<
      StatsCompilation["warnings"]
    >;
    // 변경사항 전송 로직
    if (errors.length > 0 || warnings.length > 0) {
      const hasErrors = errors.length > 0;

      if (warnings.length > 0) {
        let params;

        if (hasErrors) {
          params = { preventReloading: true };
        }

        this.sendMessage(clients, "warnings", warnings, params);
      }

      if (errors.length > 0) {
        this.sendMessage(clients, "errors", errors);
      }
    } else {
      this.sendMessage(clients, "ok");
    }
  }

  setupWatchStaticFiles() {
    const watchFiles = this.options.static;

    if (watchFiles.length > 0) {
      for (const item of watchFiles) {
        if (item.watch) {
          this.watchFiles(item.directory, item.watch);
        }
      }
    }
  }

  setupWatchFiles() {
    if (this.options.watchPath) {
      this.watchFiles(this.options.watchPath, this.options.watchOptions || {});
    }
  }

  sendMessage(clients: WebSocket[], type: string, data?: any, params?: any) {
    console.log(`클라이언트에 메시지 전송: ${type}`, data ? data : "");
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, data, params }));
      }
    }
  }

  addClient(client: WebSocket) {
    this.webSocketClients.push(client);

    // 클라이언트 연결 해제 시 제거
    client.on("close", () => {
      const idx = this.webSocketClients.indexOf(client);
      if (idx >= 0) this.webSocketClients.splice(idx, 1);
    });
  }

  // 서버 종료
  close() {
    if (this.watcher) {
      this.watcher.close();
    }
    this.webSocketClients.forEach((client) => client.terminate());
    this.webSocketClients = [];
  }

  listen(port: number = 8080, callback?: () => void) {
    this.server.listen(port, () => {
      console.log(`DevServer가 포트 ${port}에서 실행 중입니다.`);
      if (callback) callback();
    });
  }

  private getClientEntry(): string {
    const clientEntry = require.resolve("./client/index.js");
    return clientEntry;
  }

  private getClientHotEntry(): string {
    return require.resolve("webpack/hot/dev-server.js");
  }

  addAdditionalEntries(compiler: webpack.Compiler) {
    const additionalEntries = [];

    let webSocketURLStr = "";

    const searchParams = new URLSearchParams();

    const protocol = "ws:";

    searchParams.set("protocol", protocol);
    const port = this.options.port ?? "0";

    searchParams.set("port", String(port));

    const pathname = "";

    searchParams.set("pathname", pathname);

    searchParams.set("hot", String(this.options.hot));

    webSocketURLStr = searchParams.toString();
    console.log(`${this.getClientEntry()}?${webSocketURLStr}`);
    additionalEntries.push(`${this.getClientEntry()}?${webSocketURLStr}`);

    const clientHotEntry = this.getClientHotEntry();
    if (clientHotEntry) {
      additionalEntries.push(clientHotEntry);
    }

    for (const additionalEntry of additionalEntries) {
      new webpack.EntryPlugin(compiler.context, additionalEntry, {
        // eslint-disable-next-line no-undefined
        name: undefined,
      }).apply(compiler);
    }
  }

  // addAdditionalEntries(compiler: webpack.Compiler) {
  //   const additionalEntries = [];

  //   let webSocketURLStr = "";

  //   const searchParams = new URLSearchParams();

  //   const protocol = "ws:";

  //   searchParams.set("protocol", protocol);

  //   const hostname = this.options.host ?? "0.0.0.0";

  //   searchParams.set("hostname", hostname);

  //   const port = this.options.port ?? "0";

  //   searchParams.set("port", String(port));

  //   const pathname = this.options.path;

  //   searchParams.set("pathname", pathname);

  //   searchParams.set("hot", "true");

  //   webSocketURLStr = searchParams.toString();

  //   additionalEntries.push(`${this.getClientEntry()}?${webSocketURLStr}`);

  //   const clientHotEntry = this.getClientHotEntry();
  //   if (clientHotEntry) {
  //     additionalEntries.push(clientHotEntry);
  //   }

  //   const webpack = compiler.webpack;

  //   for (const additionalEntry of additionalEntries) {
  //     new webpack.EntryPlugin(compiler.context, additionalEntry, {
  //       name: undefined,
  //     }).apply(compiler);
  //   }
  // }
}

const devServer = new DevServer(compiler, config.devServer);

devServer.listen(config.devServer.port);
