import { prisma } from "../prisma";
import { RULES } from "../config";
import { generateRoomCode } from "../utils/code";

export type ParticipantDTO = {
  id: string;
  nickname: string;
  lastReadAt: string | null;
};
export type MediaType = "text" | "image" | "audio" | "video";
export type ReplyPreview = {
  id: string;
  nickname: string;
  content: string;
  type: string;
} | null;
export type MessageDTO = {
  id: string;
  nickname: string;
  clientId: string | null;
  content: string;
  type: MediaType;
  imageUrl: string | null;
  replyTo: ReplyPreview;
  createdAt: string;
};

function coerceType(t: string): MediaType {
  return t === "image" || t === "audio" || t === "video" ? t : "text";
}

// Buat room baru dengan kode unik (retry jika bentrok).
export async function createRoom(): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const existing = await prisma.room.findUnique({ where: { code } });
    if (!existing) {
      const room = await prisma.room.create({ data: { code } });
      return { id: room.id, code: room.code };
    }
  }
  throw new Error("Gagal membuat kode room unik, coba lagi");
}

export async function findRoomByCode(code: string) {
  return prisma.room.findUnique({ where: { code } });
}

// Peserta aktif di sebuah room (untuk ditampilkan di UI).
export async function getActiveParticipants(
  roomId: string
): Promise<ParticipantDTO[]> {
  const rows = await prisma.participant.findMany({
    where: { roomId, isActive: true },
    orderBy: { joinedAt: "asc" },
    select: { id: true, nickname: true, lastReadAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    lastReadAt: r.lastReadAt ? r.lastReadAt.toISOString() : null,
  }));
}

// Cari peserta (aktif/nonaktif) berdasarkan clientId di suatu room.
export async function findParticipantByClient(roomId: string, clientId: string) {
  return prisma.participant.findFirst({ where: { roomId, clientId } });
}

export async function countActiveParticipants(roomId: string): Promise<number> {
  return prisma.participant.count({
    where: { roomId, isActive: true },
  });
}

export async function isRoomFull(roomId: string): Promise<boolean> {
  const count = await countActiveParticipants(roomId);
  return count >= RULES.MAX_PARTICIPANTS;
}

export async function getMessages(roomId: string): Promise<MessageDTO[]> {
  const rows = await prisma.message.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: RULES.MESSAGE_HISTORY_LIMIT,
    select: {
      id: true,
      nickname: true,
      clientId: true,
      content: true,
      type: true,
      imageUrl: true,
      createdAt: true,
      replyTo: {
        select: { id: true, nickname: true, content: true, type: true },
      },
    },
  });
  // ambil N terakhir tapi kembalikan urut lama -> baru
  return rows.reverse().map(toMessageDTO);
}

export function toMessageDTO(m: {
  id: string;
  nickname: string;
  clientId: string | null;
  content: string;
  type: string;
  imageUrl: string | null;
  createdAt: Date;
  replyTo?: {
    id: string;
    nickname: string;
    content: string;
    type: string;
  } | null;
}): MessageDTO {
  return {
    id: m.id,
    nickname: m.nickname,
    clientId: m.clientId ?? null,
    content: m.content,
    type: coerceType(m.type),
    imageUrl: m.imageUrl ?? null,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          nickname: m.replyTo.nickname,
          content: m.replyTo.content,
          type: m.replyTo.type,
        }
      : null,
    createdAt: m.createdAt.toISOString(),
  };
}
