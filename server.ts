import express from "express";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import http from "http";
import { WebSocketServer } from "ws";

const config = require("./webpack.config.js");
const app = express();
// HTTP 서버 생성
const server = http.createServer(app);
const compiler = webpack(config);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  // 클라이언트에게 초기 메시지 전송
  ws.send(
    JSON.stringify({
      type: "connected",
      data: "WebSocket 서버에 연결되었습니다",
    })
  );

  // 클라이언트 메시지 수신
  ws.on("message", (message) => {
    console.log("클라이언트로부터 메시지:", message.toString());
  });

  // 연결 종료 처리
  ws.on("close", () => {
    console.log("클라이언트 연결이 종료되었습니다");
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
