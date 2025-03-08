import { createCounter } from "./counter";

const app = document.getElementById("app")!;
const counter = createCounter();
app.appendChild(counter);

// HMR 설정
if (module.hot) {
  module.hot.accept("./counter", () => {
    console.log("counter.js가 변경되었습니다");
    app.removeChild(counter);
    const newCounter = createCounter();
    app.appendChild(newCounter);
  });
}
