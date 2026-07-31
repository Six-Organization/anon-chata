import http from "http";
import { Server } from "socket.io";
import { createApp } from "./app";
import { config } from "./config";
import { registerSocketHandlers } from "./socket";
import { startImageCleanup } from "./imageCleanup";
import { prisma } from "./prisma";

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: config.corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  registerSocketHandlers(io);
  startImageCleanup();

  server.listen(config.port, () => {
    console.log(`[be] HTTP + Socket.IO listening on :${config.port}`);
    console.log(`[be] CORS origin: ${JSON.stringify(config.corsOrigin)}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[be] ${signal} diterima, menutup server...`);
    io.close();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[be] Gagal start:", err);
  process.exit(1);
});
