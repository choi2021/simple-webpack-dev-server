// WebSocket 클라이언트 구현
class SocketClient {
  private socket = new WebSocket(`ws://${location.host}`);
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    this.connectSocket();
  }

  private connectSocket(): void {
    this.socket.onopen = this.handleOpen.bind(this);
    this.socket.onmessage = this.handleMessage.bind(this);
    this.socket.onclose = this.handleClose.bind(this);
    this.socket.onerror = this.handleError.bind(this);
  }

  private handleOpen(): void {
    console.log("WebSocket 연결 성공");
    this.reconnectAttempts = 0;
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case "ok":
          console.log("빌드 성공! 페이지를 새로고침합니다...");
          window.location.reload();
          break;
        case "warnings":
          console.warn("빌드 경고:", message.data);
          break;
        case "errors":
          console.error("빌드 오류:", message.data);
          break;
        default:
          console.log("서버 메시지:", message);
      }
    } catch (err) {
      console.error("메시지 처리 오류:", err);
    }
  }

  private handleClose(): void {
    console.log("WebSocket 연결 종료, 재연결 시도 중...");
    this.attemptReconnect();
  }

  private handleError(error: Event): void {
    console.error("WebSocket 오류:", error);
  }

  private attemptReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        console.log(
          `재연결 시도 ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
        );
        this.connectSocket();
      }, 1000);
    } else {
      console.error("최대 재연결 시도 횟수에 도달했습니다");
    }
  }

  public send(data: any): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn("소켓이 열려있지 않아 메시지를 보낼 수 없습니다");
    }
  }
}

// 클라이언트 초기화
const socketClient = new SocketClient();

export default socketClient;
