class HMRClient {
  private socket: WebSocket;
  private moduleMap = new Map<string, any>();
  private acceptCallbacks = new Map<string, Function>();

  constructor() {
    this.socket = new WebSocket(`ws://${location.host}`);
    this.socket.onmessage = this.handleMessage.bind(this);
  }

  accept(modulePath: string, callback: Function) {
    this.acceptCallbacks.set(modulePath, callback);
  }

  private async handleMessage(event: MessageEvent) {
    const { type, path, content } = JSON.parse(event.data);

    if (type === "hmr") {
      try {
        // 모듈 코드 평가
        const moduleExports = this.evaluateModule(content);
        this.moduleMap.set(path, moduleExports);

        // accept 콜백 실행
        const callback = this.acceptCallbacks.get(path);
        if (callback) {
          callback(moduleExports);
        }
      } catch (err) {
        console.error("HMR 업데이트 실패:", err);
        // window.location.reload();
      }
    }
  }

  private evaluateModule(code: string) {
    try {
      // 모듈 컨텍스트 생성
      const exports = {};
      const module = { exports };

      // eval을 사용하여 모듈 코드 실행
      eval(`
        (function(module, exports) {
          ${code}
        })(module, exports);
      `);

      return module.exports;
    } catch (err) {
      console.error("[HMR] 모듈 평가 실패:", err);
      throw err;
    }
  }
}

export const hmrClient = new HMRClient();
