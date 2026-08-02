import { Router, Request, Response } from "express";
import multer from "multer";
import { normalizeCode } from "../utils/code";
import { normalizeNickname } from "../utils/validation";
import { uploadImageMiddleware } from "../upload";
import { UPLOADS_URL_PREFIX } from "../config";
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

// POST /api/rooms/:code/upload -> upload 1 gambar (multipart, field "image")
roomsRouter.post("/:code/upload", async (req: Request, res: Response) => {
  const code = normalizeCode(req.params.code);
  const room = await findRoomByCode(code);
  if (!room) {
    return res.status(404).json({ error: "Room tidak ditemukan" });
  }

  uploadImageMiddleware.single("image")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Gambar terlalu besar (maks 5MB)" });
      }
      return res.status(400).json({ error: "File harus berupa gambar (jpg/png/gif/webp)" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "File gambar wajib diunggah" });
    }
    const imageUrl = `${UPLOADS_URL_PREFIX}/${req.file.filename}`;
    return res.status(201).json({ imageUrl });
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
