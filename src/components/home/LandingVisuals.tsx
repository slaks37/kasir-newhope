import React, { useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  Coffee,
  Grid2X2,
  Package,
  Plus,
  Minus,
  QrCode,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import {
  BUSINESS_PRESETS,
  type BusinessSector,
} from "../../data/businessPresets";
import { formatRupiah } from "../../utils/formatters";

import { BrandMark } from "../brand/Brand";
export { BrandMark };

export function ProductPhoto({
  src,
  alt,
  eager = false,
}: {
  src?: string;
  alt: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="nh-photo-fallback" role="img" aria-label={alt}>
        <ShoppingBag aria-hidden="true" />
      </span>
    );
  const base = src.split("?")[0];
  return (
    <img
      src={`${base}?fit=crop&fm=webp&w=320&q=75`}
      srcSet={`${base}?fit=crop&fm=webp&w=160&q=75 160w, ${base}?fit=crop&fm=webp&w=320&q=75 320w`}
      sizes="(max-width: 600px) 120px, 160px"
      width="320"
      height="240"
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function RevenuePreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`nh-revenue ${compact ? "nh-revenue-compact" : ""}`}>
      <div className="nh-preview-label">
        <span>Omzet hari ini</span>
        <TrendingUp size={18} />
      </div>
      <strong>Rp 1.250.000</strong>
      <div
        className="nh-bars"
        role="img"
        aria-label="Ilustrasi penjualan pukul 08 hingga 16 dari data contoh"
      >
        {[28, 46, 37, 66, 52, 83, 68, 100, 78, 90, 72, 94].map((height, i) => (
          <i key={i} style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className="nh-preview-label">
        <span>08.00</span>
        <span>Data contoh</span>
        <span>16.00</span>
      </div>
    </div>
  );
}

/** Previews use the app's sample catalogue, never merchant records. */
export function CheckoutPreview({
  sector = "FNB",
}: {
  sector?: BusinessSector;
}) {
  const preset = BUSINESS_PRESETS[sector];
  const products = preset.products.slice(0, 4);
  const [first, second] = products;
  const orderLabels: Record<BusinessSector, string> = {
    FNB: "Bawa pulang",
    RETAIL: "Pelanggan umum",
    LAUNDRY: "Nota cucian",
    BARBERSHOP: "Layanan pelanggan",
    CARWASH: "Antrean kendaraan",
  };
  return (
    <div
      className="nh-tablet"
      role="img"
      aria-label={`Pratinjau checkout ${preset.name} menggunakan katalog contoh`}
    >
      <div className="nh-tablet-camera" />
      <div className="nh-pos-screen">
        <div className="nh-pos-top">
          <span>
            <BrandMark /> New Hope <b>POS</b>
          </span>
          <span className="nh-pos-store">
            {preset.defaultStoreName}
            <ChevronDown size={12} />
          </span>
        </div>
        <div className="nh-pos-body">
          <aside className="nh-pos-rail">
            <Grid2X2 />
            <ShoppingBag />
            <ReceiptText />
            <Package />
          </aside>
          <div className="nh-pos-catalogue">
            <div className="nh-pos-heading">
              <strong>Siap melayani hari ini?</strong>
              <Coffee size={17} />
            </div>
            <div className="nh-mock-search">
              <Search size={13} />
              Cari produk atau scan barcode
            </div>
            <div className="nh-mock-tabs">
              <b>Semua produk</b>
              <span>Favorit</span>
            </div>
            <div className="nh-preview-products">
              {products.map((p) => (
                <div className="nh-preview-product" key={p.id}>
                  <ProductPhoto
                    src={p.image}
                    alt={p.name}
                    eager={sector === "FNB"}
                  />
                  <span>{p.name}</span>
                  <div>
                    <b>{formatRupiah(p.price)}</b>
                    <Plus size={13} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="nh-preview-cart">
            <strong>
              Pesanan baru
              <ShoppingBag size={15} />
            </strong>
            <span className="nh-preview-label">{orderLabels[sector]} · #001</span>
            {[first, second].filter(Boolean).map((p, i) => (
              <div className="nh-preview-cart-line" key={p.id}>
                <span>{p.name}</span>
                <div>
                  <span>
                    {i === 0 ? "2" : "1"} × {formatRupiah(p.price)}
                  </span>
                  <Check size={12} />
                </div>
              </div>
            ))}
            <div className="nh-preview-total">
              <span>Total</span>
              <b>{formatRupiah(first.price * 2 + (second?.price || 0))}</b>
            </div>
            <div className="nh-preview-pay">
              <span>
                <Banknote size={14} />
                Tunai
              </span>
              <span>
                <QrCode size={14} />
                QRIS
              </span>
            </div>
            <span className="nh-preview-label">Pratinjau · data contoh</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StockPreview() {
  return (
    <div className="nh-stock-preview">
      <div className="nh-preview-label">
        <span>Persediaan bahan baku</span>
        <Package size={18} />
      </div>
      {[
        ["Biji kopi", "2,5 kg", 80],
        ["Susu segar", "3 liter", 28],
        ["Gula aren", "1,8 liter", 56],
      ].map(([name, amount, width]) => (
        <div className="nh-stock-row" key={name}>
          <div>
            <strong>{name}</strong>
            <span>{amount}</span>
          </div>
          <div className="nh-stock-track">
            <i style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
      <span className="nh-preview-label">Ilustrasi stok · data contoh</span>
    </div>
  );
}

export function PaymentPreview() {
  return (
    <div className="nh-payment-preview">
      <div className="nh-payment-check">
        <CheckCircle2 />
      </div>
      <strong>Pembayaran berhasil</strong>
      <b>Rp 78.000</b>
      <span>
        <QrCode size={16} />
        QRIS · contoh tampilan
      </span>
      <div>
        <ReceiptText size={16} />
        Struk siap dibagikan
      </div>
    </div>
  );
}

/** Isolated simulation: no payment gateway, storage writes, or POS mutations. */
export function CashierDemo({
  sector,
  onStepChange,
}: {
  sector: BusinessSector;
  onStepChange: (step: number) => void;
}) {
  const products = BUSINESS_PRESETS[sector].products.slice(0, 4);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<"Tunai" | "QRIS" | null>(null);
  const [complete, setComplete] = useState(false);
  const count = products.reduce((n, p) => n + (quantities[p.id] || 0), 0);
  const total = products.reduce(
    (n, p) => n + (quantities[p.id] || 0) * p.price,
    0,
  );
  const add = (id: string, delta: number) => {
    setQuantities((q) => ({ ...q, [id]: Math.max(0, (q[id] || 0) + delta) }));
    setComplete(false);
    setPayment(null);
    onStepChange(0);
  };
  const reset = () => {
    setQuantities({});
    setComplete(false);
    setPayment(null);
    onStepChange(0);
  };
  return (
    <div className="nh-demo-app">
      <div className="nh-demo-app-header">
        <span>
          <BrandMark />
          Demo kasir
        </span>
        <button type="button" className="nh-text-button" onClick={reset}>
          <RotateCcw size={16} />
          Ulangi
        </button>
      </div>
      <div className="nh-demo-app-body">
        <div className="nh-demo-products">
          <div className="nh-demo-section-title">
            <strong>Pilih produk</strong>
            <span>Data contoh</span>
          </div>
          <div className="nh-demo-product-grid">
            {products.map((p) => (
              <button
                type="button"
                className="nh-demo-product"
                key={p.id}
                onClick={() => add(p.id, 1)}
                aria-label={`Tambahkan ${p.name}, ${formatRupiah(p.price)}`}
              >
                <ProductPhoto src={p.image} alt={p.name} />
                <span>{p.name}</span>
                <div>
                  <b>{formatRupiah(p.price)}</b>
                  <Plus size={18} />
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="nh-demo-order">
          <div className="nh-demo-section-title">
            <strong>Keranjang</strong>
            <span>{count} item</span>
          </div>
          <div className="nh-demo-lines">
            {count === 0 ? (
              <div className="nh-demo-empty">
                <ShoppingBag />
                <p>Mulai dari produk favoritmu.</p>
                <span>Klik produk untuk menambah pesanan.</span>
              </div>
            ) : (
              products
                .filter((p) => quantities[p.id])
                .map((p) => (
                  <div className="nh-demo-line" key={p.id}>
                    <span>{p.name}</span>
                    <div>
                      <b>{formatRupiah(p.price * quantities[p.id])}</b>
                      <div className="nh-stepper">
                        <button
                          type="button"
                          onClick={() => add(p.id, -1)}
                          aria-label={`Kurangi ${p.name}`}
                        >
                          <Minus size={14} />
                        </button>
                        <span>{quantities[p.id]}</span>
                        <button
                          type="button"
                          onClick={() => add(p.id, 1)}
                          aria-label={`Tambah ${p.name}`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
          <div className="nh-demo-total">
            <span>Total</span>
            <strong>{formatRupiah(total)}</strong>
          </div>
          <div className="nh-demo-methods">
            {(["Tunai", "QRIS"] as const).map((method) => (
              <button
                type="button"
                key={method}
                disabled={!count || complete}
                aria-pressed={payment === method}
                onClick={() => {
                  setPayment(method);
                  onStepChange(1);
                }}
              >
                {method === "Tunai" ? (
                  <Banknote size={18} />
                ) : (
                  <QrCode size={18} />
                )}
                {method}
              </button>
            ))}
          </div>
          {payment && !complete && (
            <div className="nh-demo-payment-note">
              {payment === "QRIS" ? (
                <QrCode size={32} />
              ) : (
                <Banknote size={32} />
              )}
              <span>
                {payment === "QRIS"
                  ? "Simulasi QRIS sesuai total belanja. Tidak ada pembayaran sungguhan."
                  : "Simulasi penerimaan uang tunai sesuai total belanja."}
              </span>
            </div>
          )}
          <button
            type="button"
            className="nh-button nh-button-primary"
            disabled={!count || !payment || complete}
            onClick={() => {
              setComplete(true);
              onStepChange(2);
            }}
          >
            {complete ? "Simulasi selesai" : "Simulasikan pembayaran"}
            <ArrowUpRight size={18} />
          </button>
          <div className="nh-demo-result" role="status" aria-live="polite">
            {complete && (
              <>
                <CheckCircle2 />
                <div>
                  <strong>Pembayaran {payment} berhasil</strong>
                  <span>
                    Contoh pembaruan: stok −{count} item · omzet +
                    {formatRupiah(total)}.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="nh-demo-disclaimer">
        Demo interaktif dengan data contoh. Tidak mencatat transaksi atau
        mengubah stok usaha Anda.
      </div>
    </div>
  );
}
