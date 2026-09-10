import { ArrowUpRight, Package, Settings2, ShoppingCart } from "lucide-react";
import { usePOS } from "../../context/POSContext";

/** Contextual guidance, shown only until this store has its first order. */
export function FirstSaleGuide() {
  const { orders, setActiveTab, hasPermission } = usePOS();
  if (orders.length > 0) return null;
  const steps = [
    {
      tab: "settings" as const,
      icon: Settings2,
      title: "Lengkapi profil toko",
      description: "Periksa nama usaha, struk, dan pajak.",
    },
    {
      tab: "inventory" as const,
      icon: Package,
      title: "Tinjau katalog produk",
      description: "Sesuaikan produk, harga, dan stok.",
    },
    {
      tab: "pos" as const,
      icon: ShoppingCart,
      title: "Mulai transaksi pertama",
      description: "Pilih produk dan buat pesanan.",
    },
  ].filter((step) => hasPermission(step.tab));
  if (!steps.length) return null;
  return (
    <section className="nh-first-sale" aria-labelledby="first-sale-title">
      <div>
        <span className="nh-app-eyebrow">LANGKAH AWAL</span>
        <h2 id="first-sale-title">Siapkan transaksi pertama Anda.</h2>
        <p>Tinjau pengaturan usaha sebelum mulai melayani pelanggan.</p>
      </div>
      <div className="nh-first-sale-steps">
        {steps.map((step) => (
          <button key={step.tab} onClick={() => setActiveTab(step.tab)}>
            <step.icon size={19} />
            <span>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
