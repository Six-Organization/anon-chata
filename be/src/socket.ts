import { Server, Socket } from "socket.io";
import { prisma } from "./prisma";
import { normalizeCode } from "./utils/code";
import {
  normalizeNickname,
  normalizeMessage,
  normalizeCaption,
} from "./utils/validation";
import { resolveUploadedImage } from "./upload";
import { RULES } from "./config";
import {
  findRoomByCode,
  getActiveParticipants,
  getMessages,
  isRoomFull,
  toMessageDTO,
} from "./services/roomService";

// State per-koneksi disimpan di socket.data.
interface SocketState {
  roomId?: string;
  code?: string;
  participantId?: string;
  nickname?: string;
}

const roomChannel = (roomId: string) => `room:${roomId}`;

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    const state: SocketState = {};
    socket.data = state;

    // ---- client -> server: join_room ----
    socket.on("join_room", async (payload: { code?: string; nickname?: string }) => {
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

        const nick = normalizeNickname(payload?.nickname);
        if (!nick.ok) {
          socket.emit("error", { message: nick.error });
          return;
        }

        // Enforcement max 3 di level BE (source of truth).
        if (await isRoomFull(room.id)) {
          socket.emit("error", { message: "Room penuh" });
          return;
        }

        const participant = await prisma.participant.create({
          data: {
            roomId: room.id,
            nickname: nick.value,
            socketId: socket.id,
            isActive: true,
          },
        });

        state.roomId = room.id;
        state.code = room.code;
        state.participantId = participant.id;
        state.nickname = participant.nickname;

        socket.join(roomChannel(room.id));

        const [participants, messages] = await Promise.all([
          getActiveParticipants(room.id),
          getMessages(room.id),
        ]);

        // state awal ke pemanggil
        socket.emit("joined", {
          participantId: participant.id,
          nickname: participant.nickname,
          participants,
          messages,
        });

        // beri tahu yang lain
        socket.to(roomChannel(room.id)).emit("participant_joined", {
          nickname: participant.nickname,
          participants,
        });
      } catch (err) {
        console.error("join_room error:", err);
        socket.emit("error", { message: "Terjadi kesalahan saat join room" });
      }
    });

    // ---- client -> server: send_message (teks atau gambar) ----
    socket.on(
      "send_message",
      async (payload: { content?: string; imageUrl?: string }) => {
        try {
          if (!state.roomId || !state.nickname) {
            socket.emit("error", { message: "Belum join room" });
            return;
          }

          // Pesan gambar: imageUrl harus valid (dari endpoint upload) + file ada.
          if (payload?.imageUrl !== undefined && payload?.imageUrl !== "") {
            const imageUrl = resolveUploadedImage(payload.imageUrl);
            if (!imageUrl) {
              socket.emit("error", { message: "Gambar tidak valid" });
              return;
            }
            const caption = normalizeCaption(payload.content);
            if (!caption.ok) {
              socket.emit("error", { message: caption.error });
              return;
            }
            const saved = await prisma.message.create({
              data: {
                roomId: state.roomId,
                nickname: state.nickname,
                content: caption.value,
                type: "image",
                imageUrl,
                expiresAt: new Date(Date.now() + RULES.IMAGE_TTL_MS),
              },
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
              content: msg.value,
            },
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

    // ---- client -> server: typing (opsional) ----
    socket.on("typing", (payload: { isTyping?: boolean }) => {
      if (!state.roomId || !state.nickname) return;
      socket.to(roomChannel(state.roomId)).emit("typing", {
        nickname: state.nickname,
        isTyping: Boolean(payload?.isTyping),
      });
    });

    // ---- client -> server: leave_room (eksplisit) ----
    socket.on("leave_room", async () => {
      await handleLeave(io, socket, state);
    });

    // ---- disconnect ----
    socket.on("disconnect", async () => {
      await handleLeave(io, socket, state);
    });
  });
}

async function handleLeave(io: Server, socket: Socket, state: SocketState) {
  if (!state.roomId || !state.participantId) return;
  const { roomId, participantId, nickname } = state;

  // reset state dulu supaya idempotent (disconnect + leave_room).
  state.roomId = undefined;
  state.participantId = undefined;

  try {
    await prisma.participant.update({
      where: { id: participantId },
      data: { isActive: false, socketId: null },
    });
    socket.leave(roomChannel(roomId));

    const participants = await getActiveParticipants(roomId);
    io.to(roomChannel(roomId)).emit("participant_left", {
      nickname: nickname ?? "",
      participants,
    });
  } catch (err) {
    console.error("leave error:", err);
  }
}
