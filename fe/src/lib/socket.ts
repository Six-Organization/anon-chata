import { io, Socket } from "socket.io-client";

// Kosong => default ke origin halaman (cocok untuk same-origin via Nginx).
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;

// Buat koneksi socket baru. Auto-reconnect aktif secara default.
export function createSocket(): Socket {
  return io(SOCKET_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    transports: ["websocket", "polling"],
  });
}
