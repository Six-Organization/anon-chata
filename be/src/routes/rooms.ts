import fs from "fs";
import { Router, Request, Response } from "express";
import multer from "multer";
import { normalizeCode } from "../utils/code";
import { normalizeNickname } from "../utils/validation";
import { uploadMediaMiddleware, uploadWallpaperMiddleware } from "../upload";
import {
  UPLOADS_URL_PREFIX,
  kindFromMime,
  maxBytesForKind,
} from "../config";
import {
  createRoom,
  findRoomByCode,
  findParticipantByClient,
  getActiveParticipants,
  getMessages,
  isRoomFull,
  countActiveParticipants,
} from "../services/roomService";

export const roomsRouter = Router();

// POST /api/rooms -> buat room baru
roomsRouter.post("/", async (_req: Request, res: Response) => {
  const room = await createRoom();
  res.status(201).json({ code: room.code });
});

// POST /api/rooms/:code/join -> cek cepat apakah bisa join (validasi HTTP)
roomsRouter.post("/:code/join", async (req: Request, res: Response) => {
  const code = normalizeCode(req.params.code);
  const room = await findRoomByCode(code);
  if (!room) {
    return res.status(404).json({ error: "Room tidak ditemukan" });
  }

  const nick = normalizeNickname(req.body?.nickname);
  if (!nick.ok) {
    return res.status(400).json({ error: nick.error });
  }

  // Member yang balik (clientId sudah pernah di room ini) tidak dihitung kursi baru.
  const clientId =
    typeof req.body?.clientId === "string" && req.body.clientId.trim()
      ? req.body.clientId.trim()
      : null;
  const returning = clientId
    ? await findParticipantByClient(room.id, clientId)
    : null;

  if (!returning && (await isRoomFull(room.id))) {
    return res.status(409).json({ error: "Room penuh" });
  }

  const participants = await getActiveParticipants(room.id);
  res.status(200).json({ code: room.code, participants, nickname: nick.value });
});

// GET /api/rooms/:code -> info room + peserta aktif
roomsRouter.get("/:code", async (req: Request, res: Response) => {
  const code = normalizeCode(req.params.code);
  const room = await findRoomByCode(code);
  if (!room) {
    return res.status(404).json({ error: "Room tidak ditemukan" });
  }
  const participants = await getActiveParticipants(room.id);
  const count = await countActiveParticipants(room.id);
  res.status(200).json({ code: room.code, participants, count });
});

// POST /api/rooms/:code/upload -> upload 1 media (multipart, field "file")
roomsRouter.post("/:code/upload", async (req: Request, res: Response) => {
  const code = normalizeCode(req.params.code);
  const room = await findRoomByCode(code);
  if (!room) {
    return res.status(404).json({ error: "Room tidak ditemukan" });
  }

  uploadMediaMiddleware.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File terlalu besar" });
      }
      return res
        .status(400)
        .json({ error: "Jenis file tidak didukung (gambar/audio/video)" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "File wajib diunggah" });
    }
    const kind = kindFromMime(req.file.mimetype);
    if (!kind) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Jenis file tidak didukung" });
    }
    // batas per-jenis (limit multer = video max, jadi cek ulang di sini)
    if (req.file.size > maxBytesForKind(kind)) {
      fs.unlink(req.file.path, () => {});
      const mb = Math.round(maxBytesForKind(kind) / (1024 * 1024));
      return res.status(413).json({ error: `Ukuran ${kind} maksimal ${mb}MB` });
    }
    const url = `${UPLOADS_URL_PREFIX}/${req.file.filename}`;
    return res.status(201).json({ url, kind });
  });
});

// POST /api/rooms/:code/wallpaper -> upload gambar wallpaper (persisten)
roomsRouter.post("/:code/wallpaper", async (req: Request, res: Response) => {
  const code = normalizeCode(req.params.code);
  const room = await findRoomByCode(code);
  if (!room) {
    return res.status(404).json({ error: "Room tidak ditemukan" });
  }
  uploadWallpaperMiddleware.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Gambar terlalu besar" });
      }
      return res.status(400).json({ error: "File harus berupa gambar" });
    }
    if (!req.file) return res.status(400).json({ error: "File wajib diunggah" });
    return res
      .status(201)
      .json({ url: `/api/uploads/wallpapers/${req.file.filename}` });
  });
});

// GET /api/rooms/:code/messages -> history pesan
roomsRouter.get("/:code/messages", async (req: Request, res: Response) => {
  const code = normalizeCode(req.params.code);
  const room = await findRoomByCode(code);
  if (!room) {
    return res.status(404).json({ error: "Room tidak ditemukan" });
  }
  const messages = await getMessages(room.id);
  res.status(200).json({ messages });
});
