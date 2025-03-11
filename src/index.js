import { hmrClient } from "./hmrClient";
import { createCounter } from "./counter";

const app = document.getElementById("app");
let renderCounter = createCounter;

function render() {
  app.innerHTML = "";
  app.appendChild(renderCounter());
}

render();

// HMR 설정
hmrClient.accept("src/counter.js", (newModule) => {
  console.log("new module", newModule.createCounter);
  renderCounter = newModule.createCounter;
  render();
});
