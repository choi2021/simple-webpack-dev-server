let count = 0; // 모듈 레벨로 상태 이동

export function createCounter() {
  const div = document.createElement("div");

  const h1 = document.createElement("h1");
  h1.textContent = "카운터123";

  const p = document.createElement("p");
  p.textContent = `현재 카운트: ${count}`;

  const button = document.createElement("button");
  button.textContent = "증가";
  button.onclick = () => {
    count += 1;
    p.textContent = `현재 카운트: ${count}`;
  };

  div.appendChild(h1);
  div.appendChild(p);
  div.appendChild(button);

  return div;
}
