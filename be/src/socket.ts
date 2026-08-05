import { Server, Socket } from "socket.io";
import { prisma } from "./prisma";
import { normalizeCode } from "./utils/code";
import {
  normalizeNickname,
  normalizeMessage,
  normalizeCaption,
} from "./utils/validation";
import { resolveUploadedMedia, resolveWallpaperUrl } from "./upload";
import { RULES } from "./config";

// Jenis media yang valid untuk mediaType di send_message.
const MEDIA_TYPES = new Set(["image", "audio", "video"]);
// Preset wallpaper yang diizinkan (selain URL gambar).
const WALLPAPER_PRESETS = new Set([
  "dots",
  "grid",
  "diagonal",
  "leaves",
  "aurora",
]);
import {
  findRoomByCode,
  createRoomWithPin,
  seedDecoyMessages,
  getActiveParticipants,
  getRoomReads,
  getMessages,
  isRoomFull,
  toMessageDTO,
  MESSAGE_RELATIONS,
} from "./services/roomService";
import { sendRoomMigratedAlert } from "./mailer";

// State per-koneksi disimpan di socket.data.
interface SocketState {
  roomId?: string;
  code?: string;
  participantId?: string;
  nickname?: string;
  clientId?: string;
  inCall?: boolean;
}

const roomChannel = (roomId: string) => `room:${roomId}`;

// Peserta call per room (socketId). Untuk signaling WebRTC mesh.
const callRooms = new Map<string, Set<string>>();

function socketNickname(io: Server, sid: string): string {
  const s = io.sockets.sockets.get(sid);
  const d = s?.data as { nickname?: string } | undefined;
  return d?.nickname ?? "";
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    const state: SocketState = {};
    socket.data = state;

    // ---- client -> server: join_room ----
    socket.on(
      "join_room",
      async (payload: {
        code?: string;
        nickname?: string;
        clientId?: string;
        pin?: string;
      }) => {
      try {
        if (state.roomId) {
          socket.emit("error", { message: "Kamu sudah berada di sebuah room" });
          return;
        }
        const code = normalizeCode(String(payload?.code ?? ""));
        if (!code) {
          socket.emit("error", { message: "Kode room wajib diisi" });
          return;
        }
        const room = await findRoomByCode(code);
        if (!room) {
          socket.emit("error", { message: "Room tidak ditemukan" });
          return;
        }

        // Gate PIN + decoy: kalau room ber-PIN, wajib cocok (diminta tiap join).
        if (room.pin) {
          const pin =
            typeof payload?.pin === "string" ? payload.pin.trim() : "";
          if (!pin) {
            // Belum mencoba PIN (mis. baru buka app) -> minta PIN, JANGAN hitung gagal.
            socket.emit("pin_required", {});
            return;
          }
          if (pin === room.pin) {
            // benar -> reset counter gagal kalau ada
            if (room.pinFailCount > 0) {
              await prisma.room.update({
                where: { id: room.id },
                data: { pinFailCount: 0 },
              });
            }
          } else {
            const fails = room.pinFailCount + 1;
            if (fails >= 3) {
              // 3x gagal beruntun -> pindahkan chat ke room baru, kosongkan room
              // ini + lepas PIN, lalu BIARKAN pendobrak masuk (kosong = decoy).
              await migrateRoomToDecoy(io, room);
              room.pin = null; // sisa proses join tak minta PIN lagi
            } else {
              await prisma.room.update({
                where: { id: room.id },
                data: { pinFailCount: fails },
              });
              socket.emit("pin_required", { message: "PIN salah" });
              return;
            }
          }
        }

        const nick = normalizeNickname(payload?.nickname);
        if (!nick.ok) {
          socket.emit("error", { message: nick.error });
          return;
        }

        const clientId =
          typeof payload?.clientId === "string" && payload.clientId.trim()
            ? payload.clientId.trim().slice(0, 100)
            : null;

        // Kalau clientId ini sudah pernah join room ini, pakai ulang kursinya
        // (biar reconnect/rejoin tidak makan kursi baru & identitas tetap).
        let participant = clientId
          ? await prisma.participant.findFirst({
              where: { roomId: room.id, clientId },
            })
          : null;

        if (participant) {
          // Kursinya nonaktif tapi room keburu penuh (kursinya diambil orang) -> tolak.
          if (!participant.isActive && (await isRoomFull(room.id))) {
            socket.emit("error", { message: "Room penuh" });
            return;
          }
          participant = await prisma.participant.update({
            where: { id: participant.id },
            data: { isActive: true, socketId: socket.id, nickname: nick.value },
          });
        } else {
          // Peserta baru: enforcement max 3 (source of truth di BE).
          if (await isRoomFull(room.id)) {
            socket.emit("error", { message: "Room penuh" });
            return;
          }
          participant = await prisma.participant.create({
            data: {
              roomId: room.id,
              nickname: nick.value,
              socketId: socket.id,
              clientId,
              isActive: true,
            },
          });
        }

        state.roomId = room.id;
        state.code = room.code;
        state.participantId = participant.id;
        state.nickname = participant.nickname;
        state.clientId = clientId ?? undefined;

        socket.join(roomChannel(room.id));

        const [participants, messages, reads] = await Promise.all([
          getActiveParticipants(room.id),
          getMessages(room.id),
          getRoomReads(room.id),
        ]);

        // state awal ke pemanggil
        socket.emit("joined", {
          participantId: participant.id,
          nickname: participant.nickname,
          participants,
          messages,
          reads,
          hasPin: !!room.pin,
          wallpaper: room.wallpaper ?? null,
        });

        // beri tahu yang lain
        socket.to(roomChannel(room.id)).emit("participant_joined", {
          nickname: participant.nickname,
          participants,
        });

        // kalau ada call aktif di room ini, kabari peserta baru (utk banner "Gabung")
        const callSet = callRooms.get(room.id);
        if (callSet && callSet.size > 0) {
          socket.emit("call_active", { count: callSet.size });
        }
      } catch (err) {
        console.error("join_room error:", err);
        socket.emit("error", { message: "Terjadi kesalahan saat join room" });
      }
    });

    // ---- client -> server: send_message (teks atau gambar) ----
    socket.on(
      "send_message",
      async (payload: {
        content?: string;
        imageUrl?: string;
        mediaType?: string;
        replyToId?: string;
      }) => {
        try {
          if (!state.roomId || !state.nickname) {
            socket.emit("error", { message: "Belum join room" });
            return;
          }

          // Validasi balasan: hanya boleh membalas pesan di room yang sama.
          let replyToId: string | null = null;
          if (typeof payload?.replyToId === "string" && payload.replyToId) {
            const target = await prisma.message.findFirst({
              where: { id: payload.replyToId, roomId: state.roomId },
              select: { id: true },
            });
            replyToId = target ? target.id : null;
          }

          // Pesan media: imageUrl harus valid (dari endpoint upload) + file ada.
          if (payload?.imageUrl !== undefined && payload?.imageUrl !== "") {
            const imageUrl = resolveUploadedMedia(payload.imageUrl);
            if (!imageUrl) {
              socket.emit("error", { message: "Media tidak valid" });
              return;
            }
            const type = MEDIA_TYPES.has(String(payload?.mediaType))
              ? (payload!.mediaType as string)
              : "image";
            const caption = normalizeCaption(payload.content);
            if (!caption.ok) {
              socket.emit("error", { message: caption.error });
              return;
            }
            const saved = await prisma.message.create({
              data: {
                roomId: state.roomId,
                nickname: state.nickname,
                clientId: state.clientId ?? null,
                content: caption.value,
                type,
                imageUrl,
                replyToId,
                expiresAt: new Date(Date.now() + RULES.IMAGE_TTL_MS),
              },
              include: MESSAGE_RELATIONS,
            });
            io.to(roomChannel(state.roomId)).emit("message", toMessageDTO(saved));
            return;
          }

          // Pesan teks biasa.
          const msg = normalizeMessage(payload?.content);
          if (!msg.ok) {
            socket.emit("error", { message: msg.error });
            return;
          }
          const saved = await prisma.message.create({
            data: {
              roomId: state.roomId,
              nickname: state.nickname,
              clientId: state.clientId ?? null,
              content: msg.value,
              replyToId,
            },
            include: MESSAGE_RELATIONS,
          });
          // broadcast ke SEMUA anggota room (termasuk pengirim)
          io.to(roomChannel(state.roomId)).emit("message", toMessageDTO(saved));
        } catch (err) {
          console.error("send_message error:", err);
          socket.emit("error", { message: "Gagal mengirim pesan" });
        }
      }
    );

    // ---- client -> server: mark_read (read receipts) ----
    socket.on("mark_read", async () => {
      try {
        if (!state.roomId || !state.participantId) return;
        const now = new Date();
        await prisma.participant.update({
          where: { id: state.participantId },
          data: { lastReadAt: now },
        });
        // broadcast ke SEMUA anggota room (termasuk pengirim biar konsisten)
        io.to(roomChannel(state.roomId)).emit("read_receipt", {
          participantId: state.participantId,
          nickname: state.nickname ?? "",
          lastReadAt: now.toISOString(),
        });
      } catch (err) {
        console.error("mark_read error:", err);
      }
    });

    // ---- client -> server: react_message (reaksi emoji) ----
    socket.on(
      "react_message",
      async (payload: { messageId?: string; emoji?: string }) => {
        try {
          if (!state.roomId || !state.clientId) return;
          const messageId =
            typeof payload?.messageId === "string" ? payload.messageId : "";
          const emoji =
            typeof payload?.emoji === "string" ? payload.emoji.slice(0, 8) : "";
          if (!messageId || !emoji) return;

          // pastikan pesan ada di room ini
          const msg = await prisma.message.findFirst({
            where: { id: messageId, roomId: state.roomId },
            select: { id: true },
          });
          if (!msg) return;

          const existing = await prisma.messageReaction.findUnique({
            where: {
              messageId_clientId: { messageId, clientId: state.clientId },
            },
          });
          if (existing) {
            if (existing.emoji === emoji) {
              await prisma.messageReaction.delete({ where: { id: existing.id } });
            } else {
              await prisma.messageReaction.update({
                where: { id: existing.id },
                data: { emoji, nickname: state.nickname ?? "" },
              });
            }
          } else {
            await prisma.messageReaction.create({
              data: {
                messageId,
                clientId: state.clientId,
                nickname: state.nickname ?? "",
                emoji,
              },
            });
          }

          const reactions = await prisma.messageReaction.findMany({
            where: { messageId },
            select: { emoji: true, clientId: true, nickname: true },
          });
          io.to(roomChannel(state.roomId)).emit("message_reaction", {
            messageId,
            reactions,
          });
        } catch (err) {
          console.error("react_message error:", err);
        }
      }
    );

    // ---- client -> server: set_room_pin (set/ganti/hapus PIN room) ----
    socket.on("set_room_pin", async (payload: { pin?: string | null }) => {
      try {
        if (!state.roomId) {
          socket.emit("error", { message: "Belum join room" });
          return;
        }
        let pin: string | null = null;
        const raw = payload?.pin;
        if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
          const p = String(raw).trim();
          if (!/^\d{4}$/.test(p)) {
            socket.emit("error", { message: "PIN harus 4 angka" });
            return;
          }
          pin = p;
        }
        await prisma.room.update({
          where: { id: state.roomId },
          data: { pin },
        });
        io.to(roomChannel(state.roomId)).emit("room_pin_changed", {
          hasPin: pin !== null,
        });
      } catch (err) {
        console.error("set_room_pin error:", err);
        socket.emit("error", { message: "Gagal mengubah PIN" });
      }
    });

    // ---- client -> server: set_room_wallpaper (latar chat bersama) ----
    socket.on(
      "set_room_wallpaper",
      async (payload: { wallpaper?: string | null }) => {
        try {
          if (!state.roomId) {
            socket.emit("error", { message: "Belum join room" });
            return;
          }
          let wallpaper: string | null = null;
          const raw = payload?.wallpaper;
          if (typeof raw === "string" && raw && raw !== "none") {
            if (WALLPAPER_PRESETS.has(raw)) {
              wallpaper = raw;
            } else {
              const url = resolveWallpaperUrl(raw);
              if (!url) {
                socket.emit("error", { message: "Wallpaper tidak valid" });
                return;
              }
              wallpaper = url;
            }
          }
          await prisma.room.update({
            where: { id: state.roomId },
            data: { wallpaper },
          });
          io.to(roomChannel(state.roomId)).emit("room_wallpaper_changed", {
            wallpaper,
          });
        } catch (err) {
          console.error("set_room_wallpaper error:", err);
          socket.emit("error", { message: "Gagal mengubah wallpaper" });
        }
      }
    );

    // ---- client -> server: typing (opsional) ----
    socket.on("typing", (payload: { isTyping?: boolean }) => {
      if (!state.roomId || !state.nickname) return;
      socket.to(roomChannel(state.roomId)).emit("typing", {
        nickname: state.nickname,
        isTyping: Boolean(payload?.isTyping),
      });
    });

    // ---- WebRTC call signaling ----
    const broadcastCallState = (roomId: string) => {
      const set = callRooms.get(roomId);
      io.to(roomChannel(roomId)).emit("call_active", { count: set ? set.size : 0 });
    };

    const leaveCall = () => {
      if (!state.roomId || !state.inCall) return;
      const roomId = state.roomId;
      const set = callRooms.get(roomId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) callRooms.delete(roomId);
      }
      state.inCall = false;
      io.to(roomChannel(roomId)).emit("call_peer_left", { peerId: socket.id });
      broadcastCallState(roomId);
    };

    // masuk/mulai call
    socket.on("call_join", () => {
      if (!state.roomId) return;
      let set = callRooms.get(state.roomId);
      if (!set) {
        set = new Set();
        callRooms.set(state.roomId, set);
      }
      const peers = [...set]
        .filter((id) => id !== socket.id)
        .map((id) => ({ peerId: id, nickname: socketNickname(io, id) }));
      set.add(socket.id);
      state.inCall = true;
      socket.emit("call_peers", { peers });
      peers.forEach((p) =>
        io.to(p.peerId).emit("call_peer_joined", {
          peerId: socket.id,
          nickname: state.nickname ?? "",
        })
      );
      broadcastCallState(state.roomId);
    });

    socket.on("call_leave", () => leaveCall());

    // relay SDP/ICE ke peer tertentu
    socket.on("webrtc_signal", (payload: { to?: string; data?: unknown }) => {
      const to = typeof payload?.to === "string" ? payload.to : "";
      if (!to || !payload?.data) return;
      io.to(to).emit("webrtc_signal", { from: socket.id, data: payload.data });
    });

    // ---- client -> server: leave_room (eksplisit) ----
    socket.on("leave_room", async () => {
      leaveCall();
      await handleLeave(io, socket, state);
    });

    // ---- disconnect ----
    socket.on("disconnect", async () => {
      leaveCall();
      await handleLeave(io, socket, state);
    });
  });
}

// Decoy: pindahkan semua chat room lama ke room baru (PIN sama), kosongkan &
// lepas PIN room lama (jadi honeypot), beri tahu anggota online, kirim email.
async function migrateRoomToDecoy(
  io: Server,
  oldRoom: { id: string; code: string; pin: string | null }
): Promise<void> {
  try {
    const newRoom = await createRoomWithPin(oldRoom.pin);
    await prisma.message.updateMany({
      where: { roomId: oldRoom.id },
      data: { roomId: newRoom.id },
    });
    // anggota online diarahkan ke room baru
    io.to(roomChannel(oldRoom.id)).emit("room_migrated", { code: newRoom.code });
    // kosongkan peserta room lama + lepas PIN + reset counter
    await prisma.participant.updateMany({
      where: { roomId: oldRoom.id },
      data: { isActive: false, socketId: null },
    });
    await prisma.room.update({
      where: { id: oldRoom.id },
      data: { pin: null, pinFailCount: 0 },
    });
    // isi room decoy dgn obrolan palsu biar tampak grup sepi yang nyata
    await seedDecoyMessages(oldRoom.id);
    void sendRoomMigratedAlert(oldRoom.code, newRoom.code); // fire-and-forget
    console.log(`[decoy] ${oldRoom.code} -> ${newRoom.code} (3x gagal PIN)`);
  } catch (err) {
    console.error("[decoy] migrasi gagal:", err);
  }
}

async function handleLeave(io: Server, socket: Socket, state: SocketState) {
  if (!state.roomId || !state.participantId) return;
  const { roomId, participantId, nickname } = state;

  // reset state dulu supaya idempotent (disconnect + leave_room).
  state.roomId = undefined;
  state.participantId = undefined;

  try {
    // Nonaktifkan HANYA kalau socket ini masih pemegang kursi. Kalau koneksi baru
    // (reconnect/rejoin) sudah mengambil alih kursi, jangan diutak-atik.
    const result = await prisma.participant.updateMany({
      where: { id: participantId, socketId: socket.id },
      data: { isActive: false, socketId: null },
    });
    socket.leave(roomChannel(roomId));

    if (result.count === 0) return; // kursi sudah dipegang koneksi lain

    const participants = await getActiveParticipants(roomId);
    io.to(roomChannel(roomId)).emit("participant_left", {
      nickname: nickname ?? "",
      participants,
    });
  } catch (err) {
    console.error("leave error:", err);
  }
}
