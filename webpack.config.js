const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const baseConfig = {
  devtool: false,
  mode: "development",
  entry: ["./src/example/index.js"],
  output: {
    publicPath: "/",
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
  },
  devServer: {
    static: "./dist",
    hot: true,
    watchPath: "src/example",
    port: 3000,
  },
  target: ["web", "es5"],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/example/index.html",
    }),
  ],
  devtool: "inline-source-map",
};

module.exports = baseConfig;
