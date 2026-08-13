import React from 'react';
import { Product } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import { Plus, SlidersHorizontal, AlertCircle } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onSelect }) => {
  const isLowStock = product.stock <= product.minStockAlert && product.stock > 0;
  const isOutOfStock = product.stock <= 0;
  const hasVariants = (product.variants && product.variants.length > 0) || (product.modifierGroups && product.modifierGroups.length > 0);

  return (
    <div
      onClick={() => !isOutOfStock && onSelect(product)}
      className={`group relative bg-white border border-slate-200/90 rounded-2xl p-3 flex flex-col justify-between transition-all duration-200 cursor-pointer hover:border-amber-400 hover:shadow-md shadow-xs ${
        isOutOfStock ? 'opacity-60 cursor-not-allowed bg-slate-50 border-slate-200' : ''
      }`}
    >
      <div>
        {/* Product Image & Badges */}
        <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-100 mb-2.5">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-semibold">
              No Image
            </div>
          )}

          {/* Stock Badges */}
          {isOutOfStock ? (
            <span className="absolute top-2 right-2 bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-xs">
              Habis
            </span>
          ) : isLowStock ? (
            <span className="absolute top-2 right-2 bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-md shadow-xs flex items-center space-x-1">
              <AlertCircle className="w-3 h-3 text-amber-600" />
              <span>Sisa {product.stock}</span>
            </span>
          ) : (
            <span className="absolute top-2 right-2 bg-white/90 backdrop-blur-xs text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-200 shadow-xs">
              Stok: {product.stock}
            </span>
          )}

          {/* Variants Badge */}
          {hasVariants && (
            <span className="absolute bottom-2 left-2 bg-indigo-50/95 backdrop-blur-xs text-indigo-700 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-indigo-200 shadow-xs flex items-center space-x-1">
              <SlidersHorizontal className="w-3 h-3 text-indigo-600" />
              <span>Opsi/Kustom</span>
            </span>
          )}
        </div>

        {/* Product Details */}
        <h3 className="font-semibold text-sm text-slate-900 line-clamp-2 mb-1 group-hover:text-amber-600 transition-colors">
          {product.name}
        </h3>

        {/*
          Deskripsi dipotong dua baris. Kartu di grid kasir harus tetap sama
          tinggi — deskripsi panjang yang mendorong tombol tambah ke bawah
          membuat kasir salah tekan saat antrian ramai. `title` menyimpan teks
          utuh untuk yang perlu membacanya.
        */}
        {product.description && (
          <p
            title={product.description}
            className="text-[11px] text-slate-500 line-clamp-2 mb-1 leading-snug"
          >
            {product.description}
          </p>
        )}

        <p className="text-[11px] text-slate-500 font-mono mb-2">SKU: {product.sku}</p>
      </div>

      {/* Footer Price & Add Button */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <div>
          <span className="font-bold text-sm text-amber-600">{formatRupiah(product.price)}</span>
          <span className="text-[10px] text-slate-400 block">/ {product.unit}</span>
        </div>

        <button
          disabled={isOutOfStock}
          className={`p-2 rounded-xl text-slate-950 font-bold transition-all shadow-xs ${
            isOutOfStock
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-600 group-hover:scale-105 text-slate-950'
          }`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
