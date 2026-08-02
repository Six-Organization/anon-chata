"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoomCheck } from "@/lib/api";
import {
  getActiveSession,
  getSavedNickname,
  saveNickname,
  getClientId,
  getRecentRooms,
  removeRecentRoom,
  type RecentRoom,
} from "@/lib/identity";

export default function LandingPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [recents, setRecents] = useState<RecentRoom[]>([]);

  // Auto-rejoin room terakhir kalau sesi masih < 5 jam; kalau tidak, tampilkan landing.
  useEffect(() => {
    const session = getActiveSession();
    if (session) {
      router.replace(`/room/${session.code}`);
      return;
    }
    setNickname(getSavedNickname());
    setRecents(getRecentRooms());
    setChecking(false);
  }, [router]);

  function quickJoin(code: string) {
    saveNickname(nickname);
    router.push(`/room/${code}`);
  }

  function forgetRoom(code: string) {
    removeRecentRoom(code);
    setRecents(getRecentRooms());
  }

  async function handleCreate() {
    setError(null);
    setLoading("create");
    try {
      saveNickname(nickname);
      const { code } = await createRoom();
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat room");
      setLoading(null);
    }
  }

  async function handleJoin() {
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Masukkan kode room dulu");
      return;
    }
    setLoading("join");
    try {
      // cek cepat ke server (404 room tidak ada / 409 penuh)
      await joinRoomCheck(code, nickname.trim(), getClientId());
      saveNickname(nickname);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal gabung room");
      setLoading(null);
    }
  }

  // Selagi mengecek sesi tersimpan, jangan kedip-kedip landing.
  if (checking) {
    return <main className="min-h-[100dvh]" />;
  }

  return (
    <main className="safe-x mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-brand-dark">Anon Chat</h1>
        <p className="mt-2 text-sm text-slate-500">
          Grup chat anonim • maksimal 3 orang • tanpa daftar
        </p>
      </header>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Nickname <span className="text-slate-400">(opsional)</span>
        </label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={24}
          placeholder="Kosongkan untuk nama acak"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />

        <button
          onClick={handleCreate}
          disabled={loading !== null}
          className="mt-4 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {loading === "create" ? "Membuat…" : "Buat Room Baru"}
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          ATAU GABUNG ROOM
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="KODE ROOM"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          />
          <button
            onClick={handleJoin}
            disabled={loading !== null}
            className="shrink-0 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:opacity-60"
          >
            {loading === "join" ? "…" : "Gabung"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>

      {recents.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="mb-2 text-xs font-medium text-slate-500">
            Room terakhir — tap untuk gabung lagi
          </p>
          <div className="flex flex-wrap gap-2">
            {recents.map((r) => (
              <div
                key={r.code}
                className="flex items-center gap-1 rounded-full bg-brand/10 py-1 pl-3 pr-1 text-sm"
              >
                <button
                  onClick={() => quickJoin(r.code)}
                  className="font-mono font-semibold tracking-widest text-brand-dark"
                >
                  {r.code}
                </button>
                <button
                  onClick={() => forgetRoom(r.code)}
                  aria-label={`Hapus ${r.code}`}
                  className="grid h-5 w-5 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="text-center text-xs text-slate-400">
        Pesan tidak untuk data sensitif. Room otomatis tersimpan history-nya.
      </footer>
    </main>
  );
}
