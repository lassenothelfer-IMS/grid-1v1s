// Thin WebSocket wrapper: JSON in, JSON out.

export function connect({ onMessage, onOpen, onClose }) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}`);

  socket.addEventListener("open", () => onOpen?.());
  socket.addEventListener("close", () => onClose?.());
  socket.addEventListener("error", () => onClose?.());
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
  };
}
