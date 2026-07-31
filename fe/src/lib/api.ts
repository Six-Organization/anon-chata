// Klien REST tipis ke backend. FE TIDAK akses DB langsung (lihat /CLAUDE.md).

import type { Participant, Message } from "./types";

// Origin server BE. Kosong = same-origin (via Nginx). FE menambah prefix /api sendiri.
const ORIGIN = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

// URL endpoint REST (selalu di bawah /api).
function apiUrl(path: string): string {
  return `${ORIGIN}/api${path}`;
}

// URL aset media (path sudah termasuk /api/uploads/...).
export function mediaUrl(path: string): string {
  return `${ORIGIN}${path}`;
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return (data?.error as string) || `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

export async function createRoom(): Promise<{ code: string }> {
  const res = await fetch(apiUrl("/rooms"), { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export type JoinResult = {
  code: string;
  participants: Participant[];
  nickname: string;
};

// Cek cepat sebelum konek socket. Melempar Error dengan pesan dari server
// (mis. "Room tidak ditemukan", "Room penuh").
export async function joinRoomCheck(
  code: string,
  nickname: string
): Promise<JoinResult> {
  const res = await fetch(apiUrl(`/rooms/${encodeURIComponent(code)}/join`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function getMessages(code: string): Promise<Message[]> {
  const res = await fetch(apiUrl(`/rooms/${encodeURIComponent(code)}/messages`));
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  return data.messages as Message[];
}

// Upload satu gambar (multipart). Balikan { imageUrl } untuk emit send_message.
export async function uploadImage(
  code: string,
  file: File
): Promise<{ imageUrl: string }> {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(apiUrl(`/rooms/${encodeURIComponent(code)}/upload`), {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
