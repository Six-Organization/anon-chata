import { prisma } from "../prisma";
import { RULES } from "../config";
import { generateRoomCode } from "../utils/code";

export type ParticipantDTO = {
  id: string;
  nickname: string;
  lastReadAt: string | null;
};
export type MessageDTO = {
  id: string;
  nickname: string;
  content: string;
  type: "text" | "image";
  imageUrl: string | null;
  createdAt: string;
};

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
      content: true,
      type: true,
      imageUrl: true,
      createdAt: true,
    },
  });
  // ambil N terakhir tapi kembalikan urut lama -> baru
  return rows.reverse().map(toMessageDTO);
}

export function toMessageDTO(m: {
  id: string;
  nickname: string;
  content: string;
  type: string;
  imageUrl: string | null;
  createdAt: Date;
}): MessageDTO {
  return {
    id: m.id,
    nickname: m.nickname,
    content: m.content,
    type: m.type === "image" ? "image" : "text",
    imageUrl: m.imageUrl ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
