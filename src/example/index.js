import { createCounter } from "./counter.js";

// 카운터 렌더링 함수
let renderCounter = createCounter;

function render() {
  const appElement = document.getElementById("app");
  appElement.innerHTML = "";
  appElement.appendChild(renderCounter());
}

// 초기 렌더링
render();

// 핵심: HMR 설정
if (module.hot) {
  module.hot.accept("./counter.js", function () {
    console.log("카운터 모듈이 업데이트됨!");
    // 업데이트된 모듈로 DOM 다시 설정
    renderCounter = createCounter;
    render();
  });
}
