import React, { useEffect, useState } from "react";
import { api } from "../api";
export default function GrowthIntegration({ leadId }: { leadId?: string }) {
  const [info, setInfo] = useState<any>(null),
    [links, setLinks] = useState<any[]>([]),
    [retention, setRetention] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invite, setInvite] = useState(""),
    [busy, setBusy] = useState(false),
    [dead, setDead] = useState<any[]>([]);
  const load = async () => {
    const d = await api.growth("integration");
    setInfo(d.integration);
    try {
      const [l, r] = await Promise.all([
        api.growth("identity-links"),
        api.growth("retention"),
      ]);
      setLinks(l.links);
      setRetention(r.due);
      const q = await api.growth("integration/dead");
      setDead(q.events);
    } catch {
      /* Superadmin-only ownership queue. No role escalation. */
    }
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Permintaan gagal.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ge-panel">
      <h2>Integrasi produk & data terverifikasi</h2>
      <p>
        CRM tidak memberikan akses merchant. Pengaitan akun memerlukan
        konfirmasi pemilik tenant dan peninjauan Superadmin. Jangan menyimpulkan
        pembayaran dari tahap PAID pada CRM.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {info && (
        <>
          <p>
            Cakupan:{" "}
            {info.coverageFresh
              ? "Snapshot lengkap dan antrean terkuras"
              : "Belum lengkap atau perlu pemrosesan ulang"}
            . Pending: {info.state?.pending ?? "belum diketahui"} · Dead letter:{" "}
            {info.state?.dead ?? "belum diketahui"} · Proses terakhir:{" "}
            {info.state?.last_run_at
              ? new Date(info.state.last_run_at).toLocaleString("id-ID")
              : "belum ada"}
          </p>
          <p>
            Langganan sintetis: {info.syntheticSubscriptions} · Langganan
            first-party dengan bukti pembayaran: {info.verifiedSubscriptions}
          </p>
          <h3>Event produk dari sumber terverifikasi</h3>
          <p>
            Setiap baris menghitung UUID akun unik, bukan total transaksi atau
            omzet. Signup dapat tercatat sebelum ada tenant; pengaitan CRM tetap
            memerlukan konfirmasi.
          </p>
          <ul>
            {(info.eventCounts ?? []).map((e: any) => (
              <li key={e.data_class + e.signal}>
                {e.signal}: {e.accounts} akun ·{" "}
                {e.data_class === "synthetic" ? "SINTETIS" : "FIRST-PARTY"}
              </li>
            ))}
          </ul>
          <div className="ge-stats">
            <div className="ge-stat">
              <span>MRR IDR terverifikasi</span>
              <strong>
                {info.mrr === null
                  ? "Data belum tersedia"
                  : new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                    }).format(info.mrr)}
              </strong>
            </div>
            <div className="ge-stat">
              <span>Conversion terverifikasi</span>
              <strong>
                {info.conversion === null
                  ? "Data belum tersedia"
                  : `${info.conversion * 100}%`}
              </strong>
            </div>
            <div className="ge-stat">
              <span>Churn berbayar</span>
              <strong>
                {info.churn === null
                  ? "Data belum tersedia"
                  : `${info.churn * 100}%`}
              </strong>
            </div>
          </div>
          <p>
            {info.reason} · Tidak memasukkan pembayaran atau trial sintetis
            sebagai performa bisnis nyata.
          </p>
        </>
      )}
      <button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const r = await api.growth(
              "integration/drain",
              undefined,
              {},
              "POST",
            );
            setNotice(
              `${r.processed} event diproses; ${r.failed} perlu retry.`,
            );
          })
        }
      >
        Proses antrean Growth
      </button>
      {dead.map((e) => (
        <p key={e.id}>
          Event {e.id} · {e.attempts} percobaan · {e.last_error}
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.growth(
                  "integration/retry",
                  undefined,
                  { id: e.id },
                  "POST",
                );
              })
            }
          >
            Antrekan ulang setelah perbaikan
          </button>
        </p>
      ))}
      {leadId && (
        <div>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api.growth(
                  `leads/${leadId}/link-invites`,
                  undefined,
                  {},
                  "POST",
                );
                setInvite(
                  window.location.origin + "/overview#growth-link=" + r.token,
                );
              })
            }
          >
            Buat undangan konfirmasi akun
          </button>
          {invite && (
            <p>
              Tautan privat sekali pakai, berlaku 24 jam. Bagikan hanya kepada
              pemilik yang sah; tidak dikirim otomatis.
              <input
                aria-label="Undangan konfirmasi akun"
                readOnly
                value={invite}
                style={{ width: "100%" }}
              />
            </p>
          )}
        </div>
      )}
      <h3>Peninjauan hubungan akun</h3>
      {!links.length && (
        <p>
          Belum ada konfirmasi pemilik. Kesamaan email tidak dipakai sebagai
          bukti.
        </p>
      )}
      {links.map((l) => (
        <div key={l.id}>
          <p>
            Lead: {l.lead_id}
            <br />
            Supabase UUID: {l.subject_ref ?? "Belum dikonfirmasi"}
            <br />
            Tenant: {l.tenant_ref ?? "Belum dikonfirmasi"}
            <br />
            Status:{" "}
            {l.revoked_at
              ? "Dicabut"
              : l.approved_at
                ? "Disetujui"
                : l.claimed_at
                  ? "Menunggu tinjauan"
                  : "Menunggu pemilik"}
          </p>
          {l.claimed_at && !l.approved_at && !l.revoked_at && (
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Saya telah memverifikasi bahwa akun dan tenant yang ditampilkan adalah pemilik sah lead ini. Tidak menggabungkan UUID atau memberi akses merchant.",
                  )
                )
                  void run(async () => {
                    await api.growth(
                      `identity-links/${l.id}/approve`,
                      undefined,
                      {
                        confirmSubject: l.subject_ref,
                        confirmTenant: l.tenant_ref,
                      },
                      "POST",
                    );
                  });
              }}
            >
              Setujui hubungan yang telah diperiksa
            </button>
          )}
          {l.approved_at && !l.revoked_at && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.growth(
                    `identity-links/${l.id}/revoke`,
                    undefined,
                    {},
                    "POST",
                  );
                })
              }
            >
              Cabut hubungan Growth
            </button>
          )}
        </div>
      ))}
      <h3>Retensi kontak</h3>
      <p>
        Kontak ditinjau setelah 180 hari. Anonimisasi memerlukan tinjauan
        Superadmin dan tidak menghapus data bisnis atau billing. Event tidak
        tertaut disimpan maksimal 30 hari; event tertaut 180 hari sesuai proses
        pemeliharaan.
      </p>
      {retention.map((l) => (
        <div key={l.id}>
          <span>
            {l.company} ·{" "}
            {new Date(l.retention_until).toLocaleDateString("id-ID")}
          </span>
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Anonimkan kontak dan catatan CRM ini secara permanen? Data bisnis tetap dipertahankan.",
                )
              )
                void run(async () => {
                  await api.growth(
                    `leads/${l.id}/anonymize`,
                    undefined,
                    { confirm: true },
                    "POST",
                  );
                });
            }}
          >
            Anonimkan kontak yang jatuh tempo
          </button>
        </div>
      ))}
    </section>
  );
}
