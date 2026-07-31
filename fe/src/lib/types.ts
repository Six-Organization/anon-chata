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

export type Message = {
  id: string;
  nickname: string;
  content: string; // teks / caption
  type: "text" | "image";
  imageUrl: string | null; // path gambar bila type=image (null jika kadaluarsa)
  createdAt: string; // ISO
};

// Payload event socket server -> client
export type JoinedPayload = {
  participantId: string;
  nickname: string;
  participants: Participant[];
  messages: Message[];
};

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
