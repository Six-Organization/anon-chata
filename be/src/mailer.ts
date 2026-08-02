import nodemailer, { Transporter } from "nodemailer";
import { config } from "./config";

let transporter: Transporter | null = null;

function mailConfigured(): boolean {
  const m = config.mail;
  return Boolean(m.host && m.user && m.pass && m.alertEmail);
}

function getTransporter(): Transporter | null {
  if (!mailConfigured()) return null;
  if (!transporter) {
    const m = config.mail;
    transporter = nodemailer.createTransport({
      host: m.host,
      port: m.port,
      secure: m.port === 465, // 465 = SSL; 587 = STARTTLS (secure:false)
      auth: { user: m.user, pass: m.pass },
    });
  }
  return transporter;
}

// Kirim notifikasi kode room baru (decoy aktif). Fire-and-forget, tidak nge-blok.
export async function sendRoomMigratedAlert(
  oldCode: string,
  newCode: string
): Promise<void> {
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[mailer] MAIL_* / ALERT_EMAIL belum diset — lewati email (room baru: ${newCode})`
    );
    return;
  }
  const m = config.mail;
  try {
    await t.sendMail({
      from: `"${m.fromName}" <${m.fromAddress}>`,
      to: m.alertEmail,
      subject: `⚠️ Room dipindahkan (dari ${oldCode})`,
      text:
        `Terdeteksi 3x percobaan PIN gagal pada room ${oldCode}.\n\n` +
        `Seluruh chat sudah dipindahkan ke room baru dengan kode: ${newCode}\n` +
        `PIN tetap sama. Gunakan kode baru ini untuk masuk.\n\n` +
        `Room lama (${oldCode}) sekarang kosong & tanpa PIN (decoy).\n` +
        `Waktu: ${new Date().toISOString()}`,
    });
    console.log(`[mailer] alert terkirim ke ${m.alertEmail} (room baru ${newCode})`);
  } catch (err) {
    console.error("[mailer] gagal kirim email:", err);
  }
}
