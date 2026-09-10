import React, { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  Coffee,
  Headphones,
  Laptop,
  Menu,
  MessageCircle,
  Monitor,
  Package,
  Play,
  Printer,
  QrCode,
  ScanLine,
  Scissors,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Smartphone,
  Tablet,
  UserRound,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { usePOS } from "../../context/POSContext";
import {
  BUSINESS_PRESETS,
  type BusinessSector,
} from "../../data/businessPresets";
import { formatRupiah } from "../../utils/formatters";
import {
  BrandMark,
  CashierDemo,
  CheckoutPreview,
  PaymentPreview,
  RevenuePreview,
  StockPreview,
} from "./LandingVisuals";
import "./landing.css";

interface HomePageProps {
  onOpenLogin?: () => void;
  onOpenRegister?: () => void;
  onOpenPOS?: (targetTab?: string) => void;
  isStandaloneLanding?: boolean;
}

const WHATSAPP =
  "https://wa.me/6281234567890?text=Halo%20Tim%20New%20Hope%20POS,%20saya%20ingin%20konsultasi%20paket%20kasir%20dan%20coba%20demo";
const ONBOARDING =
  "https://wa.me/6281234567890?text=Halo%20Tim%20New%20Hope%20POS,%20saya%20mau%20dibantu%20input%20menu%20dan%20coba%20demo%20kasir";

const sectors = [
  {
    id: "FNB",
    label: "Kafe & Resto",
    icon: Coffee,
    title: "Pesanan rapi. Pelanggan senang.",
    description:
      "Dari kopi pertama sampai pesanan terakhir, kelola meja, menu, dan dapur dalam satu alur.",
    photo: "photo-1501339847302-ac426a4a7cbb",
    alt: "Ilustrasi suasana kafe dengan meja dan area pelayanan",
    features: [
      "Denah meja & pesanan dapur",
      "Varian menu dan tambahan topping",
      "Stok bahan baku sesuai resep",
    ],
  },
  {
    id: "RETAIL",
    label: "Ritel",
    icon: ShoppingBag,
    title: "Toko tertata, belanja jadi mudah.",
    description:
      "Layani belanja harian dan pantau persediaan tanpa menghitung ulang satu per satu.",
    photo: "photo-1556742049-0a67e557b640",
    alt: "Ilustrasi pelayanan pelanggan di toko ritel",
    features: [
      "Scan barcode saat checkout",
      "Pantau persediaan tiap produk",
      "Ringkasan penjualan harian",
    ],
  },
  {
    id: "LAUNDRY",
    label: "Laundry",
    icon: Shirt,
    title: "Setiap cucian jelas statusnya.",
    description:
      "Kelola cucian masuk, proses pengerjaan, dan pesanan siap ambil dalam satu tempat.",
    photo: "photo-1517677208171-0bc6725a3e60",
    alt: "Ilustrasi pakaian untuk layanan laundry",
    features: [
      "Pesanan kiloan dan satuan",
      "Pantau proses hingga siap ambil",
      "Nota digital untuk pelanggan",
    ],
  },
  {
    id: "BARBERSHOP",
    label: "Barbershop",
    icon: Scissors,
    title: "Lebih fokus pada setiap pelanggan.",
    description:
      "Atur layanan dan antrean, lalu lihat kontribusi tim tanpa rekap terpisah.",
    photo: "photo-1503951914875-452162b0f3f1",
    alt: "Ilustrasi suasana layanan barbershop",
    features: [
      "Booking dan antrean pelanggan",
      "Paket layanan dan produk",
      "Perhitungan komisi kapster",
    ],
  },
  {
    id: "CARWASH",
    label: "Carwash",
    icon: Car,
    title: "Antrean teratur, layanan terpantau.",
    description:
      "Ikuti setiap kendaraan dari masuk hingga selesai dan siap diserahkan kepada pelanggan.",
    photo: "photo-1607860108855-64acf2078ed9",
    alt: "Ilustrasi pencucian kendaraan",
    features: [
      "Antrean dan status pengerjaan",
      "Pilihan paket cuci & detailing",
      "Pantau bahan dan komisi kru",
    ],
  },
] satisfies Array<{
  id: BusinessSector;
  label: string;
  icon: typeof Coffee;
  title: string;
  description: string;
  photo: string;
  alt: string;
  features: string[];
}>;

const features = [
  {
    icon: Zap,
    title: "Kasir cepat",
    copy: "Pilih produk, atur pesanan, dan bagikan struk dalam satu alur.",
  },
  {
    icon: QrCode,
    title: "QRIS dinamis",
    copy: "Nominal pembayaran mengikuti total belanja pelanggan.",
  },
  {
    icon: Package,
    title: "Manajemen stok",
    copy: "Pantau produk dan bahan baku yang perlu diisi kembali.",
  },
  {
    icon: BarChart3,
    title: "Laporan usaha",
    copy: "Lihat penjualan, produk terlaris, dan laba kotor dengan jelas.",
  },
  {
    icon: WifiOff,
    title: "Mode offline",
    copy: "Catat transaksi tunai saat koneksi terputus; sinkronkan saat online.",
  },
  {
    icon: Monitor,
    title: "Multi-outlet",
    copy: "Pantau beberapa cabang dari satu akun sesuai paket usaha.",
  },
];
const aiExamples = [
  {
    query: "Produk apa yang hampir habis?",
    answer:
      "Susu segar tersisa 3 liter dan biji kopi 2,5 kg. Cek kembali kebutuhan toko sebelum melakukan pemesanan.",
    metric: "2 bahan perlu diperiksa",
    icon: Package,
  },
  {
    query: "Berapa omzet hari ini?",
    answer:
      "Omzet hari ini Rp 1.250.000 dari 38 transaksi. Ringkasan ini membantu Anda memantau penjualan selama toko beroperasi.",
    metric: "38 transaksi tercatat",
    icon: BarChart3,
  },
  {
    query: "Menu apa yang paling laris?",
    answer:
      "Es Kopi Susu Gula Aren paling banyak dipesan: 24 cup hari ini. Pastikan bahan untuk menu favorit ini tersedia.",
    metric: "24 cup terjual",
    icon: Coffee,
  },
];
const faqs = [
  {
    q: "Apakah tetap bisa digunakan tanpa internet?",
    a: "Transaksi tunai dapat dicatat saat koneksi terputus pada perangkat yang sudah memuat aplikasi. Data disinkronkan ketika online kembali. QRIS dan layanan online memerlukan internet.",
  },
  {
    q: "Perangkat apa yang didukung?",
    a: "Gunakan HP, tablet, iPad, atau laptop melalui browser. Koneksi printer thermal dan scanner bergantung pada perangkat, browser, dan model aksesori; konsultasikan perangkat Anda sebelum membeli.",
  },
  {
    q: "Bagaimana pencairan QRIS?",
    a: "Dana masuk ke rekening merchant sesuai jadwal dan ketentuan penyedia pembayaran yang terhubung. Tim kami dapat membantu memeriksa proses aktivasi, biaya, dan jadwal pencairannya.",
  },
  {
    q: "Apakah data lama dapat dipindahkan?",
    a: "Konsultasikan katalog lama Anda dengan tim onboarding. Siapkan daftar produk, menu, atau file Excel agar format dan cakupan data yang dapat dipindahkan bisa diperiksa.",
  },
  {
    q: "Bagaimana bantuan jika kasir bermasalah?",
    a: "Hubungi tim melalui WhatsApp dengan penjelasan kendala, perangkat, dan pesan kesalahan yang muncul. Tim akan membantu pemeriksaan dan langkah penanganan berikutnya.",
  },
];
const plans = [
  {
    id: "plan-free",
    name: "Free Trial 45 Hari",
    desc: "Bangun kebiasaan operasional tanpa kartu kredit.",
    monthly: 0,
    yearly: 0,
    features: [
      "Seluruh fitur Pro selama 45 hari",
      "Hingga 2 outlet",
      "Produk dan staf tidak terbatas",
      "Kuota AI trial terbatas",
      "Data read-only 14 hari setelah trial",
    ],
    cta: "Coba Gratis 45 Hari",
  },
  {
    id: "plan-plus-monthly",
    name: "Tier Plus",
    desc: "Untuk usaha yang mulai bertumbuh.",
    monthly: 99000,
    yearly: 79200,
    features: [
      "Hingga 2 outlet · produk tidak terbatas",
      "Kasir, QRIS & struk digital",
      "Inventori dan workflow sektor dasar",
      "Pelanggan, shift, kas & laporan omzet",
      "Extra outlet mulai Rp 63.360/bulan",
    ],
    cta: "Pilih Tier Plus",
  },
  {
    id: "plan-pro-monthly",
    name: "Tier Pro",
    desc: "Kontrol lebih lengkap untuk banyak cabang.",
    monthly: 299000,
    yearly: 248170,
    features: [
      "Hingga 4 outlet · produk tak terbatas",
      "Multi-location, transfer stok & recursive BOM",
      "Smart Labor, payroll & workflow vertikal lengkap",
      "Advanced AI & laporan gabungan antar-outlet",
      "Extra outlet mulai Rp 63.360/bulan",
    ],
    cta: "Pilih Tier Pro",
  },
];

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="nh-section-title">
      {eyebrow && <span className="nh-eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function BusinessPhoto({ sector }: { sector: (typeof sectors)[number] }) {
  const [failed, setFailed] = useState(false);
  const base = `https://images.unsplash.com/${sector.photo}`;
  return (
    <div className="nh-business-photo">
      {failed ? (
        <div className="nh-editorial-placeholder">
          <sector.icon />
          <span>[Foto suasana {sector.label}]</span>
        </div>
      ) : (
        <img
          src={`${base}?fit=crop&fm=webp&w=1000&q=80`}
          srcSet={`${base}?fit=crop&fm=webp&w=500&q=80 500w, ${base}?fit=crop&fm=webp&w=1000&q=80 1000w`}
          sizes="(max-width: 850px) 100vw, 50vw"
          alt={sector.alt}
          width="1000"
          height="740"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      <span className="nh-photo-credit">Foto ilustrasi usaha</span>
    </div>
  );
}

export const HomePage: React.FC<HomePageProps> = ({
  onOpenLogin,
  onOpenRegister,
  onOpenPOS,
}) => {
  const { user } = useAuth();
  const { setActiveTab, activateBusinessSector, settings } = usePOS();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedSector, setSelectedSector] = useState<BusinessSector>("FNB");
  const [isYearlyBilling, setIsYearlyBilling] = useState(true);
  const [aiQuery, setAiQuery] = useState(0);
  const [demoStep, setDemoStep] = useState(0);
  const [notice, setNotice] = useState("");
  const [monthlyRevenue, setMonthlyRevenue] = useState(35000000);
  const [dailyTransactions, setDailyTransactions] = useState(65);
  const [staffCount, setStaffCount] = useState(3);
  const [savingRate, setSavingRate] = useState(6.5);
  const sector = sectors.find((s) => s.id === selectedSector)!;
  const ai = aiExamples[aiQuery];
  const openPOS = (targetTab: "pos" | "settings" | "overview" = "pos") => {
    if (user) {
      setActiveTab(targetTab);
      onOpenPOS?.(targetTab);
    } else if (onOpenRegister) onOpenRegister();
    else onOpenLogin?.();
  };
  const register = () => {
    if (onOpenRegister) onOpenRegister();
    else openPOS();
  };
  const choosePlan = (id: string) => {
    sessionStorage.setItem("nhpos_pending_checkout_plan", id);
    register();
  };
  const navClose = () => setMenuOpen(false);
  const selectSector = (id: BusinessSector) => {
    setSelectedSector(id);
    setDemoStep(0);
    setNotice("");
  };
  const handleTabKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % sectors.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + sectors.length) % sectors.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sectors.length - 1;
    else return;
    event.preventDefault();
    selectSector(sectors[next].id);
    document.getElementById(`nh-tab-${sectors[next].id}`)?.focus();
  };

  return (
    <div className="nh-landing" id="nh-top">
      <a className="nh-skip-link" href="#nh-content">
        Lewati ke konten
      </a>
      <header className="nh-header">
        <div className="nh-container nh-nav">
          <a
            href="#nh-top"
            className="nh-brand"
            aria-label="New Hope POS, beranda"
          >
            <span className="nh-brand-symbol">
              <BrandMark />
            </span>
            <span>
              New Hope <b>POS</b>
            </span>
          </a>
          <nav
            className={`nh-navigation ${menuOpen ? "is-open" : ""}`}
            id="nh-navigation"
            aria-label="Navigasi utama"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                navClose();
                document.getElementById("nh-menu-toggle")?.focus();
              }
            }}
          >
            <a href="#fitur" onClick={navClose}>
              Produk
            </a>
            <a href="#sektor" onClick={navClose}>
              Solusi Usaha
            </a>
            <a href="#pricing" onClick={navClose}>
              Harga
            </a>
            <details className="nh-nav-more">
              <summary>
                Bantuan
                <ChevronDown size={14} />
              </summary>
              <div>
                <a href="#faq" onClick={navClose}>
                  Pertanyaan umum
                </a>
                <a href="#blog" onClick={navClose}>
                  Blog Harapan Baru
                </a>
                <a href="#hardware" onClick={navClose}>
                  Perangkat kasir
                </a>
                <a href="#kalkulator-profit" onClick={navClose}>
                  Kalkulator usaha
                </a>
                <a
                  href={ONBOARDING}
                  target="_blank"
                  rel="noreferrer"
                  onClick={navClose}
                >
                  Bantuan input produk
                </a>
              </div>
            </details>
            <div className="nh-mobile-auth">
              <button
                type="button"
                onClick={() => {
                  navClose();
                  user ? openPOS() : onOpenLogin?.();
                }}
              >
                {user ? "Buka Kasir" : "Masuk"}
              </button>
              <button
                type="button"
                className="nh-button nh-button-primary"
                onClick={register}
              >
                Coba Gratis
              </button>
            </div>
          </nav>
          <div className="nh-nav-actions">
            <button
              type="button"
              className="nh-login"
              onClick={() => (user ? openPOS() : onOpenLogin?.())}
            >
              {user ? "Buka Kasir" : "Masuk"}
            </button>
            <button
              type="button"
              className="nh-button nh-button-primary"
              onClick={register}
            >
              Coba Gratis
              <ArrowUpRight size={17} />
            </button>
          </div>
          <button
            type="button"
            id="nh-menu-toggle"
            className="nh-menu-toggle"
            aria-label={menuOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={menuOpen}
            aria-controls="nh-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="nh-content" tabIndex={-1}>
        <section
          className="nh-hero nh-container"
          aria-labelledby="nh-hero-title"
        >
          <div className="nh-hero-copy">
            <div className="nh-hero-eyebrow">
              <span />
              <span>Aplikasi kasir untuk UMKM Indonesia</span>
            </div>
            <h1 id="nh-hero-title">
              Kasir praktis untuk usaha yang terus <span>bertumbuh</span>
            </h1>
            <p>
              Kelola transaksi, QRIS, stok, dan laporan bisnis dari satu
              aplikasi—mudah digunakan melalui HP, tablet, maupun komputer.
            </p>
            <div className="nh-hero-actions">
              <button
                type="button"
                className="nh-button nh-button-primary"
                onClick={register}
              >
                Coba Gratis 45 Hari
                <ArrowUpRight size={19} />
              </button>
              <a className="nh-button nh-button-secondary" href="#demo-kasir">
                <Play size={17} />
                Lihat Demo Kasir
              </a>
            </div>
            <div className="nh-hero-assurances">
              <span>
                <Check size={14} />
                Tanpa kartu kredit
              </span>
              <span>
                <Check size={14} />
                Bisa digunakan offline
              </span>
              <span>
                <Check size={14} />
                Dibantu input produk
              </span>
            </div>
          </div>
          <div className="nh-hero-art">
            <div className="nh-hero-art-label">
              <span className="nh-mini-sun">✳</span>Hari baru. Peluang baru.
            </div>
            <CheckoutPreview />
            <div className="nh-hero-revenue">
              <RevenuePreview compact />
            </div>
            <div className="nh-hero-payment">
              <CheckCircle2 />
              <div>
                <strong>Pembayaran berhasil</strong>
                <span>QRIS · contoh tampilan</span>
              </div>
            </div>
            <p className="nh-art-caption">Satu kasir. Banyak kemudahan.</p>
          </div>
        </section>
        <div className="nh-trust">
          <div className="nh-container">
            {[
              { icon: QrCode, text: "Mendukung QRIS" },
              { icon: WifiOff, text: "Tetap berjalan offline" },
              { icon: Printer, text: "Printer thermal" },
              { icon: Headphones, text: "Onboarding Indonesia" },
            ].map((item) => (
              <div key={item.text}>
                <item.icon size={21} />
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="nh-section nh-container" id="produk">
          <SectionTitle
            eyebrow="Lebih ringkas. Lebih teratur."
            title="Satu aplikasi untuk operasional usaha sehari-hari"
            description="Dari melayani pelanggan sampai memantau hasil usaha, semuanya saling terhubung."
          />
          <div className="nh-solutions">
            <article>
              <div className="nh-solution-art">
                <PaymentPreview />
              </div>
              <span className="nh-card-number">01 / Pelayanan</span>
              <h3>Transaksi dan QRIS</h3>
              <p>
                Terima pesanan dan pembayaran dalam satu alur. Nominal QRIS
                mengikuti total belanja, lalu struk siap dibagikan.
              </p>
            </article>
            <article>
              <div className="nh-solution-art">
                <StockPreview />
              </div>
              <span className="nh-card-number">02 / Persediaan</span>
              <h3>Stok dan bahan baku</h3>
              <p>
                Lihat persediaan dengan jelas. Stok diperbarui setelah penjualan
                agar kebutuhan belanja bahan lebih mudah dipantau.
              </p>
            </article>
            <article>
              <div className="nh-solution-art">
                <RevenuePreview />
              </div>
              <span className="nh-card-number">03 / Perkembangan</span>
              <h3>Laporan dan keuntungan</h3>
              <p>
                Pantau omzet dan laba kotor dari mana saja. Temukan produk
                terlaris untuk membantu keputusan usaha berikutnya.
              </p>
            </article>
          </div>
        </section>

        <section className="nh-section nh-demo-section" id="demo-kasir">
          <div className="nh-container">
            <SectionTitle
              eyebrow="Coba sendiri, semudah ini"
              title="Dari pesanan ke pembayaran, tanpa ribet."
              description="Klik produk di bawah, pilih pembayaran, lalu lihat contoh stok dan laporan yang diperbarui."
            />
            <ol className="nh-demo-steps">
              {[
                "Pilih produk",
                "Terima pembayaran",
                "Stok & laporan diperbarui",
              ].map((step, i) => (
                <li
                  key={step}
                  className={demoStep === i ? "is-active" : ""}
                  aria-current={demoStep === i ? "step" : undefined}
                >
                  <span>
                    {demoStep > i ? <Check size={17} /> : `0${i + 1}`}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <CashierDemo
              key={selectedSector}
              sector={selectedSector}
              onStepChange={setDemoStep}
            />
          </div>
        </section>

        <section className="nh-section nh-container" id="sektor">
          <SectionTitle
            eyebrow="Usaha berbeda, sama mudahnya"
            title="Ada cara yang pas untuk usaha Anda."
            description="Pilih jenis usaha untuk melihat tampilan kasir dan fitur yang relevan."
          />
          <div
            className="nh-sector-tabs"
            role="tablist"
            aria-label="Jenis usaha"
          >
            {sectors.map((s, i) => (
              <button
                type="button"
                key={s.id}
                id={`nh-tab-${s.id}`}
                role="tab"
                aria-selected={selectedSector === s.id}
                aria-controls="nh-sector-panel"
                tabIndex={selectedSector === s.id ? 0 : -1}
                onKeyDown={(e) => handleTabKey(e, i)}
                onClick={() => selectSector(s.id)}
              >
                <s.icon size={20} />
                {s.label}
              </button>
            ))}
          </div>
          <div
            className="nh-sector-panel"
            id="nh-sector-panel"
            role="tabpanel"
            aria-labelledby={`nh-tab-${selectedSector}`}
            tabIndex={0}
          >
            <div className="nh-sector-visual">
              <BusinessPhoto sector={sector} key={sector.id} />
              <div className="nh-sector-mini-pos">
                <CheckoutPreview sector={selectedSector} />
              </div>
            </div>
            <div className="nh-sector-copy">
              <span className="nh-eyebrow">New Hope untuk {sector.label}</span>
              <h3>{sector.title}</h3>
              <p>{sector.description}</p>
              <ul>
                {sector.features.map((feature) => (
                  <li key={feature}>
                    <CheckCircle2 size={20} />
                    {feature}
                  </li>
                ))}
              </ul>
              <a href="#demo-kasir" className="nh-text-link">
                Coba demo {sector.label}
                <ArrowRight size={18} />
              </a>
              {user && (
                <details className="nh-sector-activate">
                  <summary>
                    Gunakan pengaturan sektor ini
                    <ChevronDown size={16} />
                  </summary>
                  <p>
                    Mode toko saat ini:{" "}
                    {BUSINESS_PRESETS[settings.businessSector || "FNB"].name}.
                    Beralih memuat katalog sektor yang dipilih dan mengosongkan
                    keranjang aktif.
                  </p>
                  <button
                    type="button"
                    className="nh-button nh-button-secondary"
                    onClick={() => {
                      activateBusinessSector(selectedSector);
                      setNotice(
                        `Mode ${sector.label} aktif. Katalog sektor siap digunakan.`,
                      );
                    }}
                  >
                    Aktifkan {sector.label}
                  </button>
                </details>
              )}
              <p className="nh-notice" role="status">
                {notice}
              </p>
            </div>
          </div>
        </section>

        <section className="nh-section nh-features-section" id="fitur">
          <div className="nh-container">
            <SectionTitle
              eyebrow="Siap menemani setiap hari"
              title="Yang dibutuhkan usaha, ada di sini."
              description="Fitur yang membantu pekerjaan harian, dari meja kasir hingga pengelolaan cabang."
            />
            <div className="nh-feature-grid">
              {features.map((f) => (
                <article key={f.title}>
                  <span className="nh-feature-icon">
                    <f.icon size={24} strokeWidth={1.6} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="nh-section nh-container nh-ai-section"
          id="ai-copilot"
        >
          <div className="nh-ai-copy">
            <span className="nh-eyebrow">Teman berpikir untuk usaha Anda</span>
            <h2>Pahami kondisi usaha tanpa membaca laporan yang rumit</h2>
            <p>
              Analisis langsung dari data toko Anda tanpa biaya tambahan untuk
              pertanyaan operasional dasar.
            </p>
            <div
              className="nh-ai-questions"
              aria-label="Contoh pertanyaan asisten"
            >
              {aiExamples.map((a, i) => (
                <button
                  type="button"
                  key={a.query}
                  aria-pressed={aiQuery === i}
                  onClick={() => setAiQuery(i)}
                >
                  {a.query}
                  <ArrowUpRight size={18} />
                </button>
              ))}
            </div>
            <small>AI Analyst lanjutan mengikuti kuota paket.</small>
          </div>
          <div className="nh-ai-chat">
            <div className="nh-ai-chat-top">
              <span className="nh-feature-icon">
                <Bot size={24} />
              </span>
              <div>
                <strong>New Hope Assistant</strong>
                <span>Contoh percakapan</span>
              </div>
            </div>
            <div className="nh-chat-content" aria-live="polite">
              <div className="nh-user-message">{ai.query}</div>
              <div className="nh-assistant-message">
                <BrandMark />
                <p>{ai.answer}</p>
              </div>
              <div className="nh-ai-metric">
                <ai.icon size={20} />
                {ai.metric}
              </div>
            </div>
            <div className="nh-ai-chat-foot">
              <ShieldCheck size={15} />
              Ilustrasi jawaban dari data contoh
            </div>
          </div>
        </section>

        <section className="nh-section nh-devices-section" id="hardware">
          <div className="nh-container nh-devices-layout">
            <div>
              <span className="nh-eyebrow">Mulai dengan yang sudah ada</span>
              <h2>Satu akun, di perangkat pilihan Anda.</h2>
              <p>
                Akses kasir melalui browser di HP, tablet, atau laptop.
                Hubungkan aksesori yang sesuai untuk meja kasir Anda.
              </p>
              <div className="nh-device-list">
                {[
                  { icon: Smartphone, name: "HP" },
                  { icon: Tablet, name: "Tablet" },
                  { icon: Laptop, name: "Laptop" },
                  { icon: Printer, name: "Printer thermal" },
                  { icon: ScanLine, name: "Scanner" },
                ].map((d) => (
                  <span key={d.name}>
                    <d.icon size={21} />
                    {d.name}
                  </span>
                ))}
              </div>
              <a
                className="nh-text-link"
                href={ONBOARDING}
                target="_blank"
                rel="noreferrer"
              >
                Cek kompatibilitas perangkat
                <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="nh-device-visual">
              <div className="nh-device-laptop">
                <div>
                  <CheckoutPreview />
                </div>
                <span />
              </div>
              <div className="nh-device-phone">
                <div className="nh-phone-notch" />
                <div className="nh-phone-top">
                  <BrandMark />
                  <span>Laporan usaha</span>
                </div>
                <RevenuePreview compact />
                <div className="nh-phone-stat">
                  <span>Transaksi</span>
                  <b>38</b>
                </div>
                <div className="nh-phone-stat">
                  <span>Produk terlaris</span>
                  <b>Kopi susu</b>
                </div>
              </div>
              <span className="nh-device-caption">
                Contoh tampilan pada laptop dan HP
              </span>
            </div>
          </div>
        </section>

        <section className="nh-section nh-container nh-story-section">
          <div>
            <span className="nh-eyebrow">Ruang untuk cerita usaha Anda</span>
            <h2>Lebih banyak waktu untuk mengembangkan usaha.</h2>
            <p>
              Pengalaman pemilik usaha akan ditampilkan setelah ulasan dan izin
              publikasi diverifikasi.
            </p>
          </div>
          <figure className="nh-testimonial">
            <span className="nh-example-label">
              Contoh tampilan · bukan testimoni pengguna
            </span>
            <blockquote>
              “Penjualan harian lebih mudah dipantau, tanpa rekap satu per
              satu.”
            </blockquote>
            <figcaption>
              <span
                className="nh-user-placeholder"
                role="img"
                aria-label="Placeholder foto pengguna"
              >
                <UserRound />
              </span>
              <div>
                <strong>Nama pemilik · Nama usaha</strong>
                <span>Kota · Lama penggunaan</span>
                <span>Hasil spesifik menunggu verifikasi</span>
              </div>
            </figcaption>
          </figure>
        </section>

        <section className="nh-section nh-pricing-section" id="pricing">
          <div className="nh-container">
            <SectionTitle
              eyebrow="Investasi sederhana untuk usaha"
              title="Mulai gratis. Bertumbuh sesuai kebutuhan."
              description="Coba selama 45 hari tanpa kartu kredit, lalu pilih paket yang sesuai dengan usaha Anda."
            />
            <div className="nh-billing-toggle" aria-label="Periode harga">
              <button
                type="button"
                aria-pressed={!isYearlyBilling}
                onClick={() => setIsYearlyBilling(false)}
              >
                Bulanan
              </button>
              <button
                type="button"
                aria-pressed={isYearlyBilling}
                onClick={() => setIsYearlyBilling(true)}
              >
                Tahunan<span>hemat hingga 20%</span>
              </button>
            </div>
            <div className="nh-pricing-grid">
              {plans.map((plan, i) => (
                <article
                  className={`nh-price-card ${i === 1 ? "nh-price-featured" : ""}`}
                  key={plan.id}
                >
                  {i === 1 && (
                    <span className="nh-recommended">
                      Rekomendasi untuk usaha bertumbuh
                    </span>
                  )}
                  <h3>{plan.name}</h3>
                  <p>{plan.desc}</p>
                  <div className="nh-price">
                    <strong>
                      {formatRupiah(
                        isYearlyBilling ? plan.yearly : plan.monthly,
                      )}
                    </strong>
                    <span>{i === 0 ? "/ 45 hari" : "/ bulan"}</span>
                  </div>
                  <div className="nh-billing-note">
                    {i === 0
                      ? "Masa coba tanpa kartu kredit"
                      : isYearlyBilling
                        ? `Ditagih ${formatRupiah(plan.yearly * 12)} / tahun`
                        : "Ditagih setiap bulan"}
                  </div>
                  <button
                    type="button"
                    className={`nh-button ${i === 1 ? "nh-button-primary" : "nh-button-secondary"}`}
                    onClick={() => choosePlan(plan.id)}
                  >
                    {plan.cta}
                    <ArrowUpRight size={17} />
                  </button>
                  <ul>
                    {plan.features.map((f) => (
                      <li key={f}>
                        <Check size={17} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <details className="nh-comparison">
              <summary>
                Lihat semua perbedaan
                <ChevronDown size={18} />
              </summary>
              <div className="nh-comparison-grid">
                {[
                  { label: "Jumlah outlet", values: ["2", "2", "4"] },
                  {
                    label: "Produk per outlet",
                    values: ["Tidak terbatas", "Tidak terbatas", "Tidak terbatas"],
                  },
                  {
                    label: "Laporan",
                    values: [
                      "Fitur Pro selama trial",
                      "Kas & omzet",
                      "Laba, margin & multi-outlet",
                    ],
                  },
                  {
                    label: "AI Analyst per bulan",
                    values: ["Kuota trial", "Kuota dasar", "Kuota lanjutan"],
                  },
                  {
                    label: "Persediaan",
                    values: [
                      "Multi-location Pro",
                      "Inventori dasar",
                      "Multi-location & recursive BOM",
                    ],
                  },
                  {
                    label: "Outlet tambahan per bulan",
                    values: ["—", "Rp 79.200", "Rp 79.200"],
                  },
                ].map((row) => (
                  <div className="nh-comparison-row" key={row.label}>
                    <strong>{row.label}</strong>
                    {row.values.map((v, i) => (
                      <div key={i}>
                        <span>{plans[i].name}</span>
                        <b>{v}</b>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          </div>
        </section>

        <section className="nh-section nh-container nh-faq-section" id="faq">
          <div>
            <span className="nh-eyebrow">Kami bantu sampai siap</span>
            <h2>Masih ada yang ingin ditanyakan?</h2>
            <p>
              Mulai dari perangkat, data produk, hingga penggunaan sehari-hari.
            </p>
            <a
              href={ONBOARDING}
              target="_blank"
              rel="noreferrer"
              className="nh-text-link"
            >
              <MessageCircle size={20} />
              Hubungi tim New Hope
              <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="nh-faq-list">
            {faqs.map((faq) => (
              <details key={faq.q}>
                <summary>
                  {faq.q}
                  <span className="nh-faq-plus" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="nh-final-cta nh-container">
          <div className="nh-final-sun">
            <BrandMark />
          </div>
          <h2>Siap membuat operasional usaha lebih sederhana?</h2>
          <p>Mulai langkah baru bersama New Hope POS.</p>
          <div className="nh-hero-actions">
            <button
              type="button"
              className="nh-button nh-button-primary"
              onClick={register}
            >
              Coba Gratis 45 Hari
              <ArrowUpRight size={19} />
            </button>
            <a
              className="nh-button nh-button-secondary"
              href={WHATSAPP}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={19} />
              Konsultasi via WhatsApp
            </a>
          </div>
          <span className="nh-final-note">
            Tanpa kartu kredit · Dibantu input produk
          </span>
        </section>

        <section className="nh-container nh-tools" id="kalkulator-profit">
          <details>
            <summary>
              Kalkulator usaha<span>Simulasi sesuai asumsi Anda</span>
              <ChevronDown size={18} />
            </summary>
            <div className="nh-calculator">
              <div>
                {[
                  {
                    id: "revenue",
                    label: "Omzet per bulan",
                    min: 10000000,
                    max: 250000000,
                    step: 5000000,
                    value: monthlyRevenue,
                    set: setMonthlyRevenue,
                    display: formatRupiah(monthlyRevenue),
                  },
                  {
                    id: "transactions",
                    label: "Transaksi per hari",
                    min: 10,
                    max: 350,
                    step: 5,
                    value: dailyTransactions,
                    set: setDailyTransactions,
                    display: `${dailyTransactions} struk`,
                  },
                  {
                    id: "staff",
                    label: "Jumlah staf",
                    min: 1,
                    max: 15,
                    step: 1,
                    value: staffCount,
                    set: setStaffCount,
                    display: `${staffCount} orang`,
                  },
                  {
                    id: "rate",
                    label: "Asumsi penghematan biaya",
                    min: 0,
                    max: 15,
                    step: 0.5,
                    value: savingRate,
                    set: setSavingRate,
                    display: `${savingRate}%`,
                  },
                ].map((input) => (
                  <label key={input.id} htmlFor={`nh-calc-${input.id}`}>
                    <span>
                      {input.label}
                      <b>{input.display}</b>
                    </span>
                    <input
                      id={`nh-calc-${input.id}`}
                      type="range"
                      min={input.min}
                      max={input.max}
                      step={input.step}
                      value={input.value}
                      onChange={(e) => input.set(Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
              <div className="nh-calculator-result">
                <span>Ilustrasi penghematan bulanan</span>
                <strong>
                  {formatRupiah(
                    Math.round((monthlyRevenue * savingRate) / 100),
                  )}
                </strong>
                <span>
                  Ilustrasi waktu:{" "}
                  {Math.round(dailyTransactions * 0.05 * 30 + staffCount * 4)}{" "}
                  jam/bulan
                </span>
                <p>
                  Asumsi waktu: 3 menit per transaksi, 30 hari operasional, dan
                  4 jam rekap per staf. Hasil ini simulasi, bukan proyeksi atau
                  jaminan penghematan.
                </p>
              </div>
            </div>
          </details>
        </section>
      </main>

      <footer className="nh-footer">
        <div className="nh-container nh-footer-main">
          <div>
            <a href="#nh-top" className="nh-brand">
              <span className="nh-brand-symbol">
                <BrandMark />
              </span>
              <span>
                New Hope <b>POS</b>
              </span>
            </a>
            <p>Harapan baru untuk usaha yang terus bertumbuh.</p>
          </div>
          <div>
            <strong>Produk</strong>
            <a href="#demo-kasir">Demo kasir</a>
            <a href="#fitur">Fitur unggulan</a>
            <a href="#ai-copilot">AI Copilot</a>
            <a href="#pricing">Paket langganan</a>
          </div>
          <div>
            <strong>Solusi usaha</strong>
            {sectors.map((s) => (
              <a key={s.id} href="#sektor" onClick={() => selectSector(s.id)}>
                {s.label}
              </a>
            ))}
          </div>
          <div>
            <strong>Bantuan & inspirasi</strong>
            <a href="#faq">Pertanyaan umum</a>
            <a href={ONBOARDING} target="_blank" rel="noreferrer">
              Bantuan input produk
            </a>
            <a href="#blog">Blog Harapan Baru</a>
            <a href="#blog/cara-membuka-kafe-modal-10-juta-sukses">
              Panduan membuka kafe
            </a>
            <a href="#blog/rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta">
              Tips usaha laundry
            </a>
            <a href="#blog/revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin">
              Panduan QRIS
            </a>
          </div>
        </div>
        <div className="nh-container nh-footer-bottom">
          <span>© {new Date().getFullYear()} New Hope POS</span>
          <span>Dibuat untuk langkah besar usaha kecil.</span>
        </div>
      </footer>
    </div>
  );
};
