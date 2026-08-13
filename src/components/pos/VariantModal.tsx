import React, { useState } from 'react';
import { Product, ProductVariant, SelectedModifier } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import { ShoppingBag, Check, Plus, Minus, X } from 'lucide-react';

interface VariantModalProps {
  product: Product;
  onClose: () => void;
  onAddToCart: (
    product: Product,
    variant?: ProductVariant,
    selectedModifiers?: SelectedModifier[],
    quantity?: number,
    notes?: string
  ) => void;
}

export const VariantModal: React.FC<VariantModalProps> = ({
  product,
  onClose,
  onAddToCart,
}) => {
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | undefined>(
    product.variants && product.variants.length > 0 ? product.variants[0] : undefined
  );

  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>(() => {
    const initial: SelectedModifier[] = [];
    if (product.modifierGroups) {
      product.modifierGroups.forEach((group) => {
        if (group.required && group.options.length > 0) {
          // auto-select first required option
          initial.push({
            groupId: group.id,
            groupName: group.name,
            optionId: group.options[0].id,
            optionName: group.options[0].name,
            price: group.options[0].price,
          });
        }
      });
    }
    return initial;
  });

  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');

  // Calculate unit price with selected options
  let unitPrice = product.price;
  if (selectedVariant) {
    unitPrice += selectedVariant.priceExtra;
  }
  selectedModifiers.forEach((m) => {
    unitPrice += m.price;
  });

  const totalPrice = unitPrice * quantity;

  // Toggle modifier selection
  const handleModifierToggle = (group: any, option: any) => {
    setSelectedModifiers((prev) => {
      // Check if group allows single selection (radio) or multiple selection (checkbox)
      if (group.required || group.maxSelect === 1) {
        // Replace previous option for this group
        const filtered = prev.filter((m) => m.groupId !== group.id);
        return [
          ...filtered,
          {
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            price: option.price,
          },
        ];
      } else {
        // Toggle optional checkbox
        const exists = prev.some((m) => m.optionId === option.id);
        if (exists) {
          return prev.filter((m) => m.optionId !== option.id);
        } else {
          return [
            ...prev,
            {
              groupId: group.id,
              groupName: group.name,
              optionId: option.id,
              optionName: option.name,
              price: option.price,
            },
          ];
        }
      }
    });
  };

  const handleConfirm = () => {
    onAddToCart(product, selectedVariant, selectedModifiers, quantity, notes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img
              src={product.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
              alt={product.name}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-xl object-cover bg-slate-100"
            />
            <div>
              <h3 className="font-bold text-base text-slate-900">{product.name}</h3>
              <p className="text-xs text-amber-700 font-semibold">{formatRupiah(product.price)} / {product.unit}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-5 divide-y divide-slate-100">
          {/* Variants Section */}
          {product.variants && product.variants.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Pilih Ukuran / Varian:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {product.variants.map((variant) => {
                  const isSelected = selectedVariant?.id === variant.id;
                  return (
                    <button
                      key={variant.id}
                      onClick={() => setSelectedVariant(variant)}
                      className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                        isSelected
                          ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="text-xs">{variant.name}</span>
                      <span className="text-[11px] font-mono text-amber-700 font-semibold">
                        {variant.priceExtra > 0 ? `+${formatRupiah(variant.priceExtra)}` : 'Standard'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modifiers Section */}
          {product.modifierGroups &&
            product.modifierGroups.map((group) => (
              <div key={group.id} className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    {group.name}
                  </label>
                  {group.required && (
                    <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                      Wajib Pilih
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {group.options.map((option) => {
                    const isSelected = selectedModifiers.some((m) => m.optionId === option.id);
                    return (
                      <button
                        key={option.id}
                        onClick={() => handleModifierToggle(group, option)}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center space-x-2">
                          <div
                            className={`w-4 h-4 rounded-md flex items-center justify-center border ${
                              isSelected
                                ? 'bg-amber-500 border-amber-500 text-slate-950'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span className="text-xs truncate">{option.name}</span>
                        </div>
                        {option.price > 0 && (
                          <span className="text-[10px] font-mono text-amber-700 font-semibold">
                            +{formatRupiah(option.price)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

          {/* Notes Input */}
          <div className="pt-4 space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Catatan Khusus Pesanan:
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cth: Kurangi manis, es dipisah, ekstra tisu..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Footer Quantity & Add Button */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between gap-4">
          {/* Quantity Selector */}
          <div className="flex items-center bg-white border border-slate-200 rounded-2xl p-1 shadow-xs">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="px-4 font-bold text-sm text-amber-700 min-w-[32px] text-center">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleConfirm}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 px-4 rounded-2xl flex items-center justify-between shadow-md transition-all"
          >
            <div className="flex items-center space-x-2">
              <ShoppingBag className="w-5 h-5" />
              <span>Tambah Ke Order</span>
            </div>
            <span className="text-sm font-extrabold font-mono">{formatRupiah(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
