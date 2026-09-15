// Thin WebSocket wrapper: JSON in, JSON out.

export function connect({ onMessage, onOpen, onClose }) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}`);
  let closed = false;

  // "error" is always followed by "close"; report the end of the line once.
  const ended = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };

  socket.addEventListener("open", () => onOpen?.());
  socket.addEventListener("close", ended);
  socket.addEventListener("error", ended);
  socket.addEventListener("message", (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      /* ignore malformed frames */
    }
  });

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
    // The raw socket, for pulling the plug from the devtools console.
    get raw() {
      return socket;
    },
  };
}
