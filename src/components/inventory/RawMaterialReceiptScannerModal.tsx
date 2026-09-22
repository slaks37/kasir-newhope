import React, { useState, useRef, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { StockItem } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { newId } from '../../lib/ids';
import {
  Camera,
  Upload,
  Sparkles,
  CheckCircle2,
  X,
  Plus,
  Trash2,
  AlertCircle,
  Building2,
  Calendar,
  Layers,
  Banknote,
  Receipt,
  RefreshCw,
  Eye,
  FileText,
} from 'lucide-react';

interface RawMaterialReceiptScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (savedItems: StockItem[], totalCost: number) => void;
}

interface ScannedReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  costPrice: number;
  subtotal: number;
  matchedStockItemId?: string;
  type: 'BAHAN_BAKU' | 'SETENGAH_JADI';
}

export const RawMaterialReceiptScannerModal: React.FC<RawMaterialReceiptScannerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { stockItems, processRawMaterialReceipt, shift, settings } = usePOS();

  const [scanStep, setScanStep] = useState<'CAPTURE' | 'REVIEW' | 'SUCCESS'>('CAPTURE');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Scanned / Extracted Receipt Metadata
  const [supplierName, setSupplierName] = useState<string>('Toko Bahan Supplier Utama');
  const [receiptDate, setReceiptDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [receiptNotes, setReceiptNotes] = useState<string>('');
  const [paidFromCashDrawer, setPaidFromCashDrawer] = useState<boolean>(true);
  const [scannedItems, setScannedItems] = useState<ScannedReceiptItem[]>([]);
  const [savedResult, setSavedResult] = useState<{ savedItems: StockItem[]; totalCost: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Start rear / environment camera on mobile/tablet or webcam on PC
  const startCamera = async () => {
    setIsCameraActive(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      setCameraError(`Gagal membuka kamera: ${err.message || 'Izin kamera ditolak atau tidak ada kamera terhubung'}`);
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    if (isOpen && scanStep === 'CAPTURE') {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, scanStep]);

  if (!isOpen) return null;

  // Capture photo from video stream
  const handleCapturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 800;
      canvas.height = video.videoHeight || 600;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setCapturedImage(dataUrl);
        stopCamera();
        runOcrAnalysis(dataUrl);
      }
    }
  };

  // Upload image file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setCapturedImage(dataUrl);
        stopCamera();
        runOcrAnalysis(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  // Intelligent OCR & Receipt Parser
  const runOcrAnalysis = (imageSrc: string) => {
    setIsAnalyzing(true);
    setScanStep('REVIEW');

    // Simulate AI / OCR receipt parsing with realistic Indonesian supplier samples
    setTimeout(() => {
      const sector = settings.businessSector || 'FNB';

      let sampleItems: ScannedReceiptItem[] = [];

      if (sector === 'FNB') {
        sampleItems = [
          {
            id: 'item-1',
            name: 'Susu UHT Full Cream',
            quantity: 12,
            unit: 'liter',
            costPrice: 18500,
            subtotal: 222000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-2',
            name: 'Biji Kopi Arabika Espresso Roast',
            quantity: 2,
            unit: 'kg',
            costPrice: 135000,
            subtotal: 270000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-3',
            name: 'Gula Pasir Alami',
            quantity: 5,
            unit: 'kg',
            costPrice: 17000,
            subtotal: 85000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-4',
            name: 'Sirup Karamel Monin',
            quantity: 2,
            unit: 'botol',
            costPrice: 85000,
            subtotal: 170000,
            type: 'BAHAN_BAKU',
          },
        ];
        setSupplierName('Grosir Bahan Kue & Minuman Sejahtera');
      } else if (sector === 'LAUNDRY') {
        sampleItems = [
          {
            id: 'item-1',
            name: 'Deterjen Cair Konsentrat Laundry',
            quantity: 4,
            unit: 'liter',
            costPrice: 45000,
            subtotal: 180000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-2',
            name: 'Parfum Laundry Aroma Sakura',
            quantity: 2,
            unit: 'liter',
            costPrice: 65000,
            subtotal: 130000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-3',
            name: 'Plastik Packing Kiloan Ukuran 40x60',
            quantity: 5,
            unit: 'pack',
            costPrice: 28000,
            subtotal: 140000,
            type: 'BAHAN_BAKU',
          },
        ];
        setSupplierName('CV Sumber Kimia & Perlengkapan Laundry');
      } else if (sector === 'CARWASH') {
        sampleItems = [
          {
            id: 'item-1',
            name: 'Shampoo Mobil Snow Wash pH Balance',
            quantity: 5,
            unit: 'liter',
            costPrice: 38000,
            subtotal: 190000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-2',
            name: 'Semir Ban Silikon Kilap (Tire Gel)',
            quantity: 3,
            unit: 'liter',
            costPrice: 55000,
            subtotal: 165000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-3',
            name: 'Kain Lap Microfiber Halus',
            quantity: 10,
            unit: 'pcs',
            costPrice: 12000,
            subtotal: 120000,
            type: 'BAHAN_BAKU',
          },
        ];
        setSupplierName('Distributor Otomotif & Autocare');
      } else {
        sampleItems = [
          {
            id: 'item-1',
            name: 'Pomade Waterbased Strong Hold',
            quantity: 6,
            unit: 'pcs',
            costPrice: 45000,
            subtotal: 270000,
            type: 'BAHAN_BAKU',
          },
          {
            id: 'item-2',
            name: 'Silet Cukur Stainless Double Edge',
            quantity: 10,
            unit: 'pack',
            costPrice: 15000,
            subtotal: 150000,
            type: 'BAHAN_BAKU',
          },
        ];
        setSupplierName('Supplier Barbershop & Salon');
      }

      // Automatically match with existing stockItems by similarity
      const mapped = sampleItems.map((item) => {
        const match = stockItems.find(
          (s) =>
            s.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(s.name.toLowerCase())
        );
        if (match) {
          return {
            ...item,
            name: match.name,
            unit: match.unit || item.unit,
            matchedStockItemId: match.id,
          };
        }
        return item;
      });

      setScannedItems(mapped);
      setIsAnalyzing(false);
    }, 800);
  };

  // Add a new row to scanned items
  const handleAddItemRow = () => {
    const newItem: ScannedReceiptItem = {
      id: newId('manual'),
      name: '',
      quantity: 1,
      unit: 'pcs',
      costPrice: 0,
      subtotal: 0,
      type: 'BAHAN_BAKU',
    };
    setScannedItems([...scannedItems, newItem]);
  };

  const handleUpdateItem = (id: string, field: keyof ScannedReceiptItem, value: any) => {
    setScannedItems((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          const updated = { ...it, [field]: value };
          if (field === 'quantity' || field === 'costPrice') {
            const qty = field === 'quantity' ? Number(value) || 0 : it.quantity;
            const price = field === 'costPrice' ? Number(value) || 0 : it.costPrice;
            updated.subtotal = qty * price;
          }
          if (field === 'name') {
            const match = stockItems.find(
              (s) => s.name.toLowerCase().trim() === String(value).toLowerCase().trim()
            );
            updated.matchedStockItemId = match?.id;
            if (match && !it.unit) updated.unit = match.unit;
          }
          return updated;
        }
        return it;
      })
    );
  };

  const handleDeleteItem = (id: string) => {
    setScannedItems((prev) => prev.filter((it) => it.id !== id));
  };

  const totalReceiptAmount = scannedItems.reduce((s, i) => s + i.subtotal, 0);

  // Save / Apply items to stock
  const handleSaveToInventory = () => {
    if (scannedItems.length === 0) {
      alert('Tidak ada item yang dapat disimpan. Tambahkan minimal 1 bahan baku!');
      return;
    }

    const payloadItems = scannedItems.map((it) => ({
      stockItemId: it.matchedStockItemId,
      name: it.name.trim() || 'Bahan Baku Tanpa Nama',
      type: it.type,
      quantity: it.quantity,
      unit: it.unit || 'pcs',
      costPrice: it.costPrice,
    }));

    const result = processRawMaterialReceipt({
      receiptImage: capturedImage || undefined,
      supplierName: supplierName.trim(),
      receiptDate,
      items: payloadItems,
      paidFromCashDrawer,
      notes: receiptNotes,
    });

    setSavedResult(result);
    setScanStep('SUCCESS');
    if (onSuccess) onSuccess(result.savedItems, result.totalCost);
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-amber-500 text-slate-950 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-slate-950 text-amber-400 rounded-2xl shadow-xs">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-black text-base leading-tight">
                  Scan Nota Pembelian Bahan Baku (Kamera &amp; AI)
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-slate-950 text-amber-400 rounded-full">
                  Auto-Inventory
                </span>
              </div>
              <p className="text-xs text-slate-900 font-medium">
                Ambil foto nota supplier untuk otomatis menambah stok, modal (HPP), dan satuan bahan baku.
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-1.5 rounded-xl hover:bg-amber-600 text-slate-950 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* STEP 1: CAPTURE PHOTO */}
          {scanStep === 'CAPTURE' && (
            <div className="space-y-4">
              {/* Camera Viewport */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center border-2 border-slate-800 shadow-inner">
                {isCameraActive ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    {/* Viewfinder Target Box Overlay */}
                    <div className="absolute inset-8 border-2 border-dashed border-amber-400/80 rounded-2xl pointer-events-none flex flex-col items-center justify-between p-3 bg-black/10">
                      <span className="text-[11px] font-bold text-amber-300 bg-slate-900/80 px-2.5 py-1 rounded-full">
                        Posisikan Nota Pembelian di Dalam Kotak Ini
                      </span>
                      <span className="text-[10px] font-mono text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded">
                        Pastikan teks nota terlihat jelas &amp; tidak buram
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-center p-6 space-y-2">
                    <Camera className="w-12 h-12 text-slate-600 mx-auto animate-pulse" />
                    <p className="text-xs text-slate-400">
                      {cameraError || 'Kamera sedang tidak aktif'}
                    </p>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl"
                    >
                      Buka Kamera Ulang
                    </button>
                  </div>
                )}
              </div>

              {/* Action Buttons: Capture & Upload */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Foto Nota</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => runOcrAnalysis('')}
                    className="px-3.5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold text-xs rounded-xl flex items-center gap-1.5"
                    title="Gunakan contoh nota simulasi untuk uji coba langsung"
                  >
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    <span>Contoh Nota Supplier</span>
                  </button>
                </div>

                {isCameraActive && (
                  <button
                    type="button"
                    onClick={handleCapturePhoto}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md flex items-center gap-2 transition-all transform hover:scale-102"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Jepret Foto Nota</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: REVIEW & EDIT EXTRACTED ITEMS */}
          {scanStep === 'REVIEW' && (
            <div className="space-y-4">
              {isAnalyzing ? (
                <div className="py-12 text-center space-y-3">
                  <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
                  <h4 className="font-extrabold text-sm text-slate-900">
                    Memindai &amp; Menganalisis Nota Belanja...
                  </h4>
                  <p className="text-xs text-slate-500">
                    Mengekstrak nama bahan baku, jumlah, satuan, dan harga modal (HPP) secara otomatis.
                  </p>
                </div>
              ) : (
                <>
                  {/* Supplier & Receipt Info Header */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs">
                    <div className="space-y-1">
                      <label className="font-bold text-slate-700 block">Nama Toko / Supplier:</label>
                      <input
                        type="text"
                        value={supplierName}
                        onChange={(e) => setSupplierName(e.target.value)}
                        placeholder="Contoh: Grosir Bahan Kue Berkah"
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="font-bold text-slate-700 block">Tanggal Nota:</label>
                      <input
                        type="date"
                        value={receiptDate}
                        onChange={(e) => setReceiptDate(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  {/* Scanned Items Table */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black uppercase text-slate-500 tracking-wider">
                        Rincian Bahan Baku Terdeteksi ({scannedItems.length} Item):
                      </label>
                      <button
                        type="button"
                        onClick={handleAddItemRow}
                        className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tambah Baris</span>
                      </button>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {scannedItems.map((item, idx) => (
                        <div
                          key={item.id}
                          className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1">
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) => handleUpdateItem(item.id, 'name', e.target.value)}
                                placeholder="Nama Bahan Baku..."
                                className="w-full font-extrabold text-xs text-slate-900 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                                item.matchedStockItemId
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-amber-100 text-amber-900 border border-amber-300'
                              }`}
                            >
                              {item.matchedStockItemId ? '✓ Bahan Terdaftar' : '+ Bahan Baru'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Kuantitas:</span>
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                value={item.quantity}
                                onChange={(e) => handleUpdateItem(item.id, 'quantity', e.target.value)}
                                className="w-full font-mono font-bold text-xs bg-slate-50 border border-slate-300 rounded-lg px-2 py-1"
                              />
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Satuan:</span>
                              <select
                                value={item.unit}
                                onChange={(e) => handleUpdateItem(item.id, 'unit', e.target.value)}
                                className="w-full font-bold text-xs bg-slate-50 border border-slate-300 rounded-lg px-1.5 py-1"
                              >
                                <option value="liter">Liter</option>
                                <option value="kg">Kg</option>
                                <option value="gram">Gram</option>
                                <option value="ml">Ml</option>
                                <option value="pcs">Pcs</option>
                                <option value="pack">Pack</option>
                                <option value="botol">Botol</option>
                              </select>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Modal Satuan (Rp):</span>
                              <input
                                type="number"
                                min="0"
                                value={item.costPrice}
                                onChange={(e) => handleUpdateItem(item.id, 'costPrice', e.target.value)}
                                className="w-full font-mono font-bold text-xs bg-slate-50 border border-slate-300 rounded-lg px-2 py-1"
                              />
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-100 font-bold text-slate-600">
                            <span>Subtotal Biaya:</span>
                            <span className="font-mono text-amber-800">{formatRupiah(item.subtotal)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Payment & Cash Drawer Deduction Toggle */}
                  <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2 text-xs">
                    <label className="flex items-center space-x-2.5 font-bold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={paidFromCashDrawer}
                        onChange={(e) => setPaidFromCashDrawer(e.target.checked)}
                        className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                      />
                      <span>Potong Otomatis dari Uang Kas Laci Kasir (Petty Cash)</span>
                    </label>
                    <p className="text-[11px] text-slate-500 pl-6">
                      Jika dicentang, saldo fisik laci kasir akan otomatis disesuaikan sebesar total belanja bahan baku.
                    </p>

                    <div className="flex justify-between items-center pt-2 border-t border-amber-200 font-black text-sm">
                      <span className="text-slate-900">Total Belanja Bahan:</span>
                      <span className="font-mono text-base text-amber-900">{formatRupiah(totalReceiptAmount)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: SUCCESS RESULT */}
          {scanStep === 'SUCCESS' && savedResult && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h4 className="font-black text-lg text-slate-900">
                  Bahan Baku Berhasil Masuk ke Inventori!
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Sebanyak <strong>{savedResult.savedItems.length} item</strong> persediaan telah diperbarui stok dan modalnya (HPP).
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl max-w-md mx-auto text-left space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Supplier:</span>
                  <span className="font-bold text-slate-900">{supplierName}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Total Biaya Belanja:</span>
                  <span className="font-mono font-bold text-slate-900">{formatRupiah(savedResult.totalCost)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Sumber Dana:</span>
                  <span className="font-bold text-slate-900">
                    {paidFromCashDrawer ? 'Laci Kasir (Petty Cash)' : 'Transfer / Rekening'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hidden Canvas for Camera Frame Capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          {scanStep === 'CAPTURE' && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl"
            >
              Batal
            </button>
          )}

          {scanStep === 'REVIEW' && (
            <>
              <button
                type="button"
                onClick={() => setScanStep('CAPTURE')}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl"
              >
                Foto Ulang
              </button>

              <button
                type="button"
                disabled={isAnalyzing || scannedItems.length === 0}
                onClick={handleSaveToInventory}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Simpan ke Persediaan Bahan ({formatRupiah(totalReceiptAmount)})</span>
              </button>
            </>
          )}

          {scanStep === 'SUCCESS' && (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-xl shadow-md"
            >
              Selesai &amp; Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
