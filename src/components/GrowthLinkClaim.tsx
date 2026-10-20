import React, { useState } from "react";
import { supabase } from "../lib/supabase";
export default function GrowthLinkClaim({
  inviteToken,
}: {
  inviteToken: string | null;
}) {
  const [tenant, setTenant] = useState(""),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (action: "claim" | "withdraw") => {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw Error("Masuk kembali dengan akun Anda sendiri.");
      const token = inviteToken;
      const r = await fetch("/api/v1/sync/growth/" + action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + data.session.access_token,
        },
        body: JSON.stringify({
          token,
          tenantId: tenant,
          consent,
          consentVersion: "growth-product-analytics-v1",
        }),
      });
      const b = await r.json();
      if (!r.ok)
        throw Error(
          b.error === "REAUTH_REQUIRED"
            ? "Masuk ulang pada 10 menit terakhir sebelum mengonfirmasi."
            : b.error,
        );
      setMessage(
        action === "claim"
          ? "Konfirmasi diterima. Menunggu peninjauan Superadmin; akses usaha tidak berubah."
          : "Persetujuan Growth ditarik. Akses usaha tidak berubah.",
      );
      if (action === "claim") {
        try {
          sessionStorage.removeItem("nh_growth_invite");
        } catch {
          /* ephemeral fallback */
        }
        history.replaceState(null, "", window.location.pathname);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Belum berhasil. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="nh-auth min-h-screen grid place-items-center p-6">
      <section className="max-w-lg space-y-4 rounded-2xl border bg-white p-6">
        <h1 className="text-xl font-bold">Konfirmasi hubungan Growth</h1>
        <p>
          Hanya akun pemilik tenant yang dapat mengonfirmasi. UUID akun tidak
          digabung dan izin merchant tidak berubah. Jangan buka undangan yang
          bukan ditujukan kepada Anda.
        </p>
        <label className="block">
          UUID tenant milik Anda
          <input
            className="block w-full border p-2"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
          />
        </label>
        <label className="block">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          Saya setuju event penggunaan produk saya dikaitkan ke lead Growth
          untuk analitik aktivasi. Ini bukan persetujuan email, WhatsApp, atau
          AI eksternal. Kontak ditinjau setelah 180 hari; persetujuan dapat
          ditarik di sini.
        </label>
        <button
          disabled={!consent || busy}
          onClick={() => run("claim")}
          className="rounded-xl bg-amber-400 px-4 py-3 font-bold"
        >
          Konfirmasi akun dan tenant
        </button>
        <button
          disabled={busy}
          onClick={() => run("withdraw")}
          className="block underline"
        >
          Tarik persetujuan Growth akun saya
        </button>
        <p role="status">{message}</p>
        <a
          href="/overview"
          onClick={() => {
            try {
              sessionStorage.removeItem("nh_growth_invite");
            } catch {
              /* ephemeral fallback */
            }
          }}
        >
          Kembali ke aplikasi
        </a>
      </section>
    </main>
  );
}
