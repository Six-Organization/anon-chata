// Tipe bersama sesuai kontrak di /CLAUDE.md.

export type Participant = {
  id: string;
  nickname: string;
  lastReadAt: string | null; // ISO; kapan peserta ini terakhir membaca
};

export type ReadReceiptPayload = {
  participantId: string;
  nickname: string;
  lastReadAt: string;
};

export type MediaType = "text" | "image" | "audio" | "video";

export type ReplyPreview = {
  id: string;
  nickname: string;
  content: string;
  type: string;
} | null;

export type Reaction = { emoji: string; clientId: string; nickname: string };

export type Message = {
  id: string;
  nickname: string;
  clientId: string | null; // identitas pengirim (utk tentukan bubble sendiri lintas sesi)
  content: string; // teks / caption
  type: MediaType;
  imageUrl: string | null; // URL media (image/audio/video); null jika kadaluarsa
  replyTo: ReplyPreview;
  reactions: Reaction[];
  createdAt: string; // ISO
};

export type MessageReactionPayload = { messageId: string; reactions: Reaction[] };

// Payload event socket server -> client
export type JoinedPayload = {
  participantId: string;
  nickname: string;
  participants: Participant[];
  messages: Message[];
  reads: Participant[]; // riwayat baca semua peserta (termasuk yg sudah keluar)
  hasPin: boolean;
  wallpaper: string | null; // latar chat room (preset id atau URL gambar)
};

export type PinRequiredPayload = { message?: string };
export type RoomPinChangedPayload = { hasPin: boolean };
export type RoomMigratedPayload = { code: string };
export type RoomWallpaperChangedPayload = { wallpaper: string | null };

export type ParticipantChangePayload = {
  nickname: string;
  participants: Participant[];
};

export type TypingPayload = {
  nickname: string;
  isTyping: boolean;
};

export type SocketErrorPayload = {
  message: string;
};
