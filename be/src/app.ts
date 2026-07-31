import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { roomsRouter } from "./routes/rooms";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ["GET", "POST"],
    })
  );
  app.use(express.json({ limit: "64kb" }));

  // Health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use("/api/rooms", roomsRouter);

  // Gambar statis (disajikan dari filesystem; auto-hapus 24 jam oleh cleanup job)
  app.use(
    "/api/uploads",
    express.static(config.uploadDir, { index: false, maxAge: "1h" })
  );

  // 404 untuk route API yang tidak dikenal
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Endpoint tidak ditemukan" });
  });

  // Error handler terpusat
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
