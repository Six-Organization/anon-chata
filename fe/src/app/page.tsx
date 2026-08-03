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
    return <main className="min-h-[100dvh] bg-emerald-950" />;
  }

  return (
    <main className="safe-x relative flex min-h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-800 px-4 py-10">
      {/* cahaya matahari menembus kanopi */}
      <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-lime-400/20 blur-3xl" />

      {/* siluet bukit & pohon pinus di dasar */}
      <svg
        aria-hidden="true"
        viewBox="0 0 400 140"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full text-emerald-950"
      >
        <path
          fill="currentColor"
          opacity="0.6"
          d="M0 90 Q 60 60 120 82 T 240 78 T 400 88 V140 H0 Z"
        />
        <g fill="currentColor">
          {[30, 80, 150, 210, 275, 340].map((x, i) => {
            const h = [46, 60, 38, 66, 44, 56][i];
            const w = h * 0.55;
            const base = 140;
            return (
              <polygon
                key={x}
                points={`${x},${base - h} ${x - w},${base} ${x + w},${base}`}
              />
            );
          })}
        </g>
      </svg>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6">
        <header className="text-center text-white">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-lime-300 ring-1 ring-lime-400/30">
            🌿 Trail Series 2026
          </span>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight">
            RIMBA
            <br />
            TRAIL RUN
          </h1>
          <p className="mt-2 text-sm text-emerald-100/80">
            Ultra jungle trail lintas hutan tropis · 5K · 10K · 21K
          </p>
        </header>

        <div className="rounded-2xl bg-white/95 p-6 shadow-xl ring-1 ring-emerald-900/10 backdrop-blur">
          <h2 className="mb-3 text-base font-bold text-emerald-900">
            Registrasi Peserta
          </h2>

          <label className="mb-1 block text-sm font-medium text-slate-700">
            Nama Pelari <span className="text-slate-400">(opsional)</span>
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={24}
            placeholder="Kosongkan untuk nomor peserta acak"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
          />

          <button
            onClick={handleCreate}
            disabled={loading !== null}
            className="mt-4 w-full rounded-lg bg-lime-500 py-2.5 text-sm font-bold text-emerald-950 transition hover:bg-lime-400 disabled:opacity-60"
          >
            {loading === "create" ? "Mendaftar…" : "Daftar Sekarang"}
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            SUDAH PUNYA KODE?
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="KODE REGISTRASI"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            <button
              onClick={handleJoin}
              disabled={loading !== null}
              className="shrink-0 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:opacity-60"
            >
              {loading === "join" ? "…" : "Masuk"}
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        {recents.length > 0 && (
          <div className="rounded-2xl bg-white/90 p-4 shadow-lg ring-1 ring-emerald-900/10 backdrop-blur">
            <p className="mb-2 text-xs font-medium text-emerald-800">
              Pendaftaran terakhir — tap untuk lanjut
            </p>
            <div className="flex flex-wrap gap-2">
              {recents.map((r) => (
                <div
                  key={r.code}
                  className="flex items-center gap-1 rounded-full bg-emerald-100 py-1 pl-3 pr-1 text-sm"
                >
                  <button
                    onClick={() => quickJoin(r.code)}
                    className="font-mono font-semibold tracking-widest text-emerald-800"
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

        <footer className="text-center text-xs text-emerald-200/60">
          Rimba Trail Run 2026 · Kawasan Hutan Lindung · Info &amp; ketentuan
          peserta
        </footer>
      </div>
    </main>
  );
}
