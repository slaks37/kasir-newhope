import React, { useState } from "react";
import { Product } from "../../types";
import { formatRupiah } from "../../utils/formatters";
import { Plus, SlidersHorizontal, ShoppingBag } from "lucide-react";

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onSelect,
}) => {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const isLowStock =
    product.stock <= product.minStockAlert && product.stock > 0;
  const isOutOfStock = product.stock <= 0;
  const hasVariants =
    (product.variants && product.variants.length > 0) ||
    (product.modifierGroups && product.modifierGroups.length > 0);

  return (
    <button
      type="button"
      disabled={isOutOfStock}
      onClick={() => onSelect(product)}
      className="nh-product-card"
      aria-label={`${hasVariants ? "Pilih opsi" : "Tambahkan"} ${product.name}, ${formatRupiah(product.price)}${isOutOfStock ? ", stok habis" : ""}`}
      title={product.description || product.name}
    >
      <span className="nh-product-image">
        {product.image && failedImage !== product.image ? (
          <img
            src={product.image}
            alt=""
            loading="lazy"
            decoding="async"
            width={320}
            height={220}
            referrerPolicy="no-referrer"
            onError={() => setFailedImage(product.image || null)}
          />
        ) : (
          <ShoppingBag size={30} />
        )}
        <span
          className={`nh-product-stock ${isOutOfStock ? "is-out" : isLowStock ? "is-low" : ""}`}
        >
          {isOutOfStock
            ? "Stok habis"
            : isLowStock
              ? `Sisa ${product.stock}`
              : `Stok ${product.stock}`}
        </span>
      </span>
      <span className="nh-product-info">
        <span className="nh-product-name">{product.name}</span>
        <span className="nh-product-unit">
          {product.unit}
          {hasVariants ? " · Pilihan tersedia" : ""} · {product.sku}
        </span>
        <span className="nh-product-price">
          {formatRupiah(product.price)}
          <span className="nh-product-add" aria-hidden="true">
            {hasVariants ? <SlidersHorizontal size={14} /> : <Plus size={17} />}
          </span>
        </span>
      </span>
    </button>
  );
};
