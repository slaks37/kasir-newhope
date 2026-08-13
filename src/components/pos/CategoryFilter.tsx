import React from 'react';
import { Category } from '../../types';

interface CategoryFilterProps {
  categories: Category[];
  selectedCategoryId: string;
  onSelectCategory: (id: string) => void;
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  categories,
  selectedCategoryId,
  onSelectCategory,
}) => {
  return (
    <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
      <button
        onClick={() => onSelectCategory('all')}
        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
          selectedCategoryId === 'all'
            ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20 font-bold'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
        }`}
      >
        ✨ Semua
      </button>

      {categories.map((cat) => {
        const isSelected = selectedCategoryId === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center space-x-1.5 ${
              isSelected
                ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20 font-bold'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
            }`}
          >
            <span>{cat.icon || '☕'}</span>
            <span>{cat.name}</span>
          </button>
        );
      })}
    </div>
  );
};
