import express from "express";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import chokidar from "chokidar";
import path from "path";

const config = require("./webpack.config.js");
const app = express();
// HTTP 서버 생성
const server = http.createServer(app);
const compiler = webpack(config);

const wss = new WebSocketServer({ server });

const clients: Set<WebSocket> = new Set();

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  // 클라이언트에게 초기 메시지 전송
  ws.send(
    JSON.stringify({
      type: "connected",
      data: "WebSocket 서버에 연결되었습니다",
    })
  );

  // 클라이언트 메시지 수신
  ws.onmessage = (message) => {
    console.log("클라이언트로부터 메시지:", message.toString());
  };

  // 연결 종료 처리
  ws.onclose = () => {
    clients.delete(ws);
    console.log("클라이언트 연결이 종료되었습니다");
  };
});

const watchOptions = {
  ignored: /(node_modules|\.git)/,
  persistent: true,
  ignoreInitial: true,
};

const watchPaths = [
  path.resolve(__dirname, "src"),
  path.resolve(__dirname, "public"),
];

const watcher = chokidar.watch(watchPaths, watchOptions);

// 파일 변경 이벤트 처리
watcher.on("all", (event, filePath) => {
  console.log(`파일 ${event}: ${filePath}`);

  // 웹팩에서 처리하는 파일인지 확인 (필요시 필터링)
  const isWebpackAsset = /\.(js|ts|tsx|jsx|css|scss|less|html|json)$/.test(
    filePath
  );

  // 모든 연결된 클라이언트에게 파일 변경 알림
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // OPEN
      client.send(
        JSON.stringify({
          type: "fileChanged",
          event: event,
          path: filePath,
          isWebpackAsset,
        })
      );
    }
  });
});

// Tell express to use the webpack-dev-middleware and use the webpack.config.js
// configuration file as a base.
app.use(
  webpackDevMiddleware(compiler, {
    publicPath: config.output.publicPath,
  })
);

server.listen(3000, function () {
  console.log("Example app listening on port 3000!\n");
});
