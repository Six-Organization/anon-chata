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
export type ReactionDTO = { emoji: string; clientId: string; nickname: string };
export type MessageDTO = {
  id: string;
  nickname: string;
  clientId: string | null;
  content: string;
  type: MediaType;
  imageUrl: string | null;
  replyTo: ReplyPreview;
  reactions: ReactionDTO[];
  createdAt: string;
};

// include/select bersama untuk relasi pesan (reply + reactions).
export const MESSAGE_RELATIONS = {
  replyTo: { select: { id: true, nickname: true, content: true, type: true } },
  reactions: { select: { emoji: true, clientId: true, nickname: true } },
} as const;

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

// Buat room baru dengan PIN tertentu (dipakai saat decoy migration).
export async function createRoomWithPin(
  pin: string | null
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const existing = await prisma.room.findUnique({ where: { code } });
    if (!existing) {
      const room = await prisma.room.create({ data: { code, pin } });
      return { id: room.id, code: room.code };
    }
  }
  throw new Error("Gagal membuat kode room unik, coba lagi");
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

// Obrolan palsu untuk room decoy — biar terlihat seperti grup sepi yang nyata,
// bukan jebakan kosong. Bertema santai (nyambung "trail run").
const DECOY_SCRIPT: { nick: string; content: string; minsAgo: number }[] = [
  { nick: "Andi", content: "Besok jadi lari pagi ga?", minsAgo: 2880 },
  { nick: "Rani", content: "Jadi dong, jam 6 di gerbang ya", minsAgo: 2874 },
  { nick: "Andi", content: "Oke jangan telat kayak minggu lalu 😅", minsAgo: 2869 },
  { nick: "Rani", content: "Iya iya, aku bawa air lebih banyak deh", minsAgo: 2860 },
  { nick: "Andi", content: "Rute yang biasa aja ya, 5k dulu", minsAgo: 1500 },
  { nick: "Rani", content: "Boleh, cuaca kayaknya cerah kok", minsAgo: 1494 },
  { nick: "Andi", content: "Sip, sampai besok 👍", minsAgo: 1440 },
  { nick: "Rani", content: "Btw hpku lowbat, off dulu ya", minsAgo: 1434 },
];

export async function seedDecoyMessages(roomId: string): Promise<void> {
  const now = Date.now();
  await prisma.message.createMany({
    data: DECOY_SCRIPT.map((m) => ({
      roomId,
      nickname: m.nick,
      content: m.content,
      type: "text",
      createdAt: new Date(now - m.minsAgo * 60 * 1000),
    })),
  });
}

// Riwayat baca SEMUA peserta (aktif maupun tidak) yang punya last_read_at.
// Dipakai untuk read receipt yang tetap bertahan walau pembacanya keluar.
export async function getRoomReads(roomId: string): Promise<ParticipantDTO[]> {
  const rows = await prisma.participant.findMany({
    where: { roomId, lastReadAt: { not: null } },
    orderBy: { joinedAt: "asc" },
    select: { id: true, nickname: true, lastReadAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    lastReadAt: r.lastReadAt ? r.lastReadAt.toISOString() : null,
  }));
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
      ...MESSAGE_RELATIONS,
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
  reactions?: { emoji: string; clientId: string; nickname: string }[];
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
    reactions: m.reactions ?? [],
    createdAt: m.createdAt.toISOString(),
  };
}
