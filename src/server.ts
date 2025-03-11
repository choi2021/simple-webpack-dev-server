import express from "express";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import fs from "fs";
import http from "http";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set<WebSocket>();

// 1. 웹팩 설정 및 컴파일러
const config = require("../webpack.config.js");
const compiler = webpack(config);

// 2. 파일 변경 감지
const watcher = chokidar.watch("src", {
  ignored: /node_modules/,
  persistent: true,
});

function convertToCommonJS(code: string) {
  // ES 모듈을 CommonJS로 간단히 변환
  return code
    .replace(/export\s+function\s+(\w+)/g, "exports.$1 = function")
    .replace(/export\s+const\s+(\w+)\s*=/g, "exports.$1 =")
    .replace(/export\s+let\s+(\w+)\s*=/g, "exports.$1 =")
    .replace(/export\s+class\s+(\w+)/g, "exports.$1 = class $1")
    .replace(/export\s+default\s+/g, "module.exports = ")
    .replace(
      /import\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"]/g,
      'const { $1 } = require("$2")'
    )
    .replace(
      /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
      'const $1 = require("$2")'
    );
}

watcher.on("change", (filePath) => {
  // 변경된 파일 내용 읽기
  const content = fs.readFileSync(filePath, "utf-8");

  // CommonJS 형식으로 변환
  const commonJSContent = convertToCommonJS(content);

  // 클라이언트에 변경 알림
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "hmr",
          path: filePath,
          content: commonJSContent,
        })
      );
    }
  });
});

// 3. WebSocket 연결 처리
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

// 4. 웹팩 미들웨어 설정
app.use(webpackDevMiddleware(compiler));

server.listen(3000, () => {
  console.log("Server is running on port 3000");
});
