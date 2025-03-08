import express from "express";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
const config = require("./webpack.config.js");

const app = express();
const compiler = webpack(config);

// Tell express to use the webpack-dev-middleware and use the webpack.config.js
// configuration file as a base.
app.use(
  webpackDevMiddleware(compiler, {
    publicPath: config.output.publicPath,
  })
);

app.listen(3000, function () {
  console.log("Example app listening on port 3000!\n");
});
