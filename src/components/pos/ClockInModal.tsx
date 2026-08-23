import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { StaffMember, GeoLocationInfo, calculateDistanceMeters } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import {
  Clock,
  UserCheck,
  LogOut,
  LogIn,
  Search,
  CheckCircle2,
  XCircle,
  History,
  FileText,
  X,
  MapPin,
  Compass,
  Building2,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Store,
} from 'lucide-react';
import { BUSINESS_PRESETS } from '../../data/businessPresets';

interface ClockInModalProps {
  onClose: () => void;
}

export const ClockInModal: React.FC<ClockInModalProps> = ({ onClose }) => {
  const {
    staffMembers,
    attendanceLogs,
    clockInStaff,
    clockOutStaff,
    getActiveAttendance,
    branches,
    activeBranch,
    settings,
  } = usePOS();

  const activeSectorPreset =
    BUSINESS_PRESETS[settings.businessSector || 'FNB'] || BUSINESS_PRESETS.FNB;

  const [activeTab, setActiveTab] = useState<'clock_in' | 'history'>('clock_in');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    // Tanpa cabang mana pun, biarkan kosong. 'branch-senayan' adalah id
    // cabang contoh yang tidak pernah ada di toko siapa pun, sehingga
    // pemeriksaan geofence mencari titik pembanding yang tidak akan ditemukan
    // dan absensi tercatat tanpa lokasi tanpa satu pun peringatan.
    activeBranch?.id || branches[0]?.id || ''
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  // Geolocation state
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const selectedBranch = branches.find((b) => b.id === selectedBranchId) || branches[0];

  const fetchCurrentLocation = () => {
    setIsLocating(true);
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError('Geolocation tidak didukung oleh browser Anda.');
      setIsLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
        setIsLocating(false);
      },
      (err) => {
        setLocationError(`Akses GPS gagal / ditolak: ${err.message}`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Live timer & auto-fetch location on mount
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    fetchCurrentLocation();
    return () => clearInterval(timer);
  }, []);

  let distanceFromBranchMeters: number | null = null;
  let isWithinRadius = false;

  if (userCoords && selectedBranch) {
    distanceFromBranchMeters = calculateDistanceMeters(
      userCoords.latitude,
      userCoords.longitude,
      selectedBranch.latitude,
      selectedBranch.longitude
    );
    isWithinRadius = distanceFromBranchMeters <= selectedBranch.allowedRadiusMeters;
  }

  const formattedLiveTime = currentTime.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const formattedLiveDate = currentTime.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // `staffMembers` from usePOS() is already scoped to the active sector.
  const filteredStaff = staffMembers.filter(
    (stf) =>
      stf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      stf.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalActiveClockedIn = staffMembers.filter((stf) => getActiveAttendance(stf.id)).length;

  const handleNoteChange = (staffId: string, val: string) => {
    setNoteInputs((prev) => ({ ...prev, [staffId]: val }));
  };

  const handleToggleClockIn = (staff: StaffMember) => {
    const activeRecord = getActiveAttendance(staff.id);
    const note = noteInputs[staff.id] || '';

    let geoInfo: GeoLocationInfo | undefined = undefined;
    if (userCoords) {
      geoInfo = {
        latitude: userCoords.latitude,
        longitude: userCoords.longitude,
        accuracyMeters: userCoords.accuracy,
        distanceFromBranchMeters: distanceFromBranchMeters || 0,
        isWithinRadius,
        locationName: `Lat ${userCoords.latitude.toFixed(4)}, Lon ${userCoords.longitude.toFixed(4)}`,
      };
    }

    if (!activeRecord && settings.geofenceEnforcement === 'STRICT' && userCoords && !isWithinRadius) {
      alert(
        `Akses Presensi Ditolak! Anda berada ${distanceFromBranchMeters} meter dari cabang "${selectedBranch.name}" (Maksimal Radius Toleransi: ${selectedBranch.allowedRadiusMeters} meter).`
      );
      return;
    }

    const branchInfo = selectedBranch ? { id: selectedBranch.id, name: selectedBranch.name } : undefined;

    if (activeRecord) {
      clockOutStaff(staff.id, note, geoInfo, branchInfo);
    } else {
      clockInStaff(staff.id, note, geoInfo, branchInfo);
    }

    setNoteInputs((prev) => ({ ...prev, [staff.id]: '' }));
  };

  const calculateDurationHours = (startStr: string, endStr?: string) => {
    const start = new Date(startStr).getTime();
    const end = endStr ? new Date(endStr).getTime() : Date.now();
    const diffHours = (end - start) / (1000 * 3600);
    return diffHours.toFixed(1);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-4xl w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-amber-400 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-extrabold tracking-wide">
                  Presensi & Geo-Tagging Staff (Clock In / Out)
                </h2>
                <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30 px-2.5 py-0.5 rounded-full uppercase">
                  Semua Modul & Cabang
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Pencatatan jam masuk & pulang staff lengkap dengan geofencing GPS per cabang
              </p>
            </div>
          </div>

          {/* Live Digital Clock Widget */}
          <div className="flex items-center space-x-4">
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl px-4 py-2 text-right">
              <div className="text-xs text-slate-400 font-sans">{formattedLiveDate}</div>
              <div className="text-xl font-black font-mono text-amber-400 tracking-wider">
                {formattedLiveTime} <span className="text-xs font-semibold text-slate-300">WIB</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Geo-Tagging Status Bar */}
        <div className="bg-slate-900 text-white px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5 font-bold text-amber-400">
              <Building2 className="w-4 h-4 text-amber-400" />
              <span>Pilih Cabang Tugas:</span>
            </div>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white font-semibold rounded-xl px-3 py-1 text-xs focus:ring-2 focus:ring-amber-500"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.allowedRadiusMeters}m radius)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            {isLocating ? (
              <span className="flex items-center space-x-1.5 text-slate-300">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Mendeteksi GPS Perangkat...</span>
              </span>
            ) : userCoords ? (
              <div className="flex items-center space-x-2">
                <span className="text-slate-300 font-mono text-[11px] flex items-center space-x-1">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" />
                  <span>
                    GPS: {userCoords.latitude.toFixed(4)}, {userCoords.longitude.toFixed(4)} (±{userCoords.accuracy}m)
                  </span>
                </span>

                {distanceFromBranchMeters !== null && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] flex items-center space-x-1 ${
                      isWithinRadius
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    {isWithinRadius ? (
                      <>
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>DALAM RADIUS ({distanceFromBranchMeters}m)</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-3 h-3 text-rose-400" />
                        <span>DI LUAR RADIUS ({distanceFromBranchMeters}m dari lokasi)</span>
                      </>
                    )}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-rose-400 font-semibold flex items-center space-x-1">
                <Compass className="w-3.5 h-3.5" />
                <span>{locationError || 'GPS Belum Aktif'}</span>
              </span>
            )}

            <button
              onClick={fetchCurrentLocation}
              className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Refresh Lokasi GPS"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab & Controls Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('clock_in')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
                activeTab === 'clock_in'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>Daftar Staff ({staffMembers.length})</span>
              <span className="bg-slate-950 text-amber-400 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {totalActiveClockedIn} Aktif
              </span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
                activeTab === 'history'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Log Riwayat Absensi & Geo-Tag ({attendanceLogs.length})</span>
            </button>
          </div>

          {activeTab === 'clock_in' && (
            <div className="flex items-center space-x-2">
              {/*
                The cross-sector dropdown was removed on purpose. Staff are now
                scoped to the active business sector in POSContext, so a picker
                offering other sectors would only ever return an empty list.
              */}
              <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-extrabold rounded-xl px-3 py-2 whitespace-nowrap">
                <Store className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                Staf {activeSectorPreset.name}
              </span>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari nama staff..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-900 text-xs font-semibold rounded-xl pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Body Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'clock_in' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredStaff.map((staff) => {
                const activeRecord = getActiveAttendance(staff.id);
                const isClockedIn = !!activeRecord;
                const noteValue = noteInputs[staff.id] || '';

                return (
                  <div
                    key={staff.id}
                    className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                      isClockedIn
                        ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <img
                          src={
                            staff.avatar ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(
                              staff.name
                            )}&background=f59e0b&color=fff`
                          }
                          alt={staff.name}
                          className="w-11 h-11 rounded-xl object-cover border border-slate-200 shadow-xs shrink-0"
                        />
                        <div>
                          <h4 className="font-extrabold text-sm text-slate-900 leading-tight">
                            {staff.name}
                          </h4>
                          <span className="text-xs text-slate-500 block font-medium">
                            {staff.role}
                          </span>
                          <span className="inline-block text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 mt-1">
                            {staff.sector}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      {isClockedIn ? (
                        <div className="text-right">
                          <span className="px-2.5 py-1 rounded-full bg-emerald-600 text-white font-extrabold text-[10px] flex items-center space-x-1 shadow-xs">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>CLOCKED IN</span>
                          </span>
                          <span className="text-[10px] text-emerald-700 font-mono font-bold block mt-1">
                            Masuk: {formatDateTime(activeRecord.clockInTime).split(',')[1]}
                          </span>
                        </div>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-600 font-bold text-[10px] flex items-center space-x-1">
                          <XCircle className="w-3 h-3 text-slate-400" />
                          <span>BELUM MASUK</span>
                        </span>
                      )}
                    </div>

                    {/* Optional Note Field */}
                    <div className="space-y-1">
                      <input
                        type="text"
                        placeholder={
                          isClockedIn
                            ? 'Catatan jam keluar (opsional)...'
                            : 'Catatan shift / tugas (opsional)...'
                        }
                        value={noteValue}
                        onChange={(e) => handleNoteChange(staff.id, e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    {/* Clock In / Out Action Button */}
                    <button
                      onClick={() => handleToggleClockIn(staff)}
                      className={`w-full py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center space-x-2 transition-all shadow-xs ${
                        isClockedIn
                          ? 'bg-rose-600 hover:bg-rose-700 text-white'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {isClockedIn ? (
                        <>
                          <LogOut className="w-4 h-4" />
                          <span>Clock Out (Pulang / Selesai Shift)</span>
                        </>
                      ) : (
                        <>
                          <LogIn className="w-4 h-4" />
                          <span>Clock In (Presensi Masuk Work)</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            /* History Logs View */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-amber-600" />
                  <span>Riwayat Kehadiran Staff & Geo-Tag GPS</span>
                </h3>
                <span className="text-xs text-slate-500 font-mono">
                  Total Log: {attendanceLogs.length} Entri
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4">Nama Staff</th>
                      <th className="py-3 px-4">Cabang Toko</th>
                      <th className="py-3 px-4">Clock In / Out</th>
                      <th className="py-3 px-4">Durasi</th>
                      <th className="py-3 px-4">Geo-Location GPS</th>
                      <th className="py-3 px-4">Catatan</th>
                      <th className="py-3 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {attendanceLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-slate-400 font-sans">
                          Belum ada riwayat absensi staff.
                        </td>
                      </tr>
                    ) : (
                      attendanceLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900 font-sans">
                            <div>{log.staffName}</div>
                            <div className="text-[10px] text-slate-500 font-normal">{log.staffRole}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-700 font-sans font-medium">
                            {log.branchName || 'Cabang Utama'}
                          </td>
                          <td className="py-3 px-4 text-slate-800 text-[11px]">
                            <div className="text-emerald-700 font-semibold">In: {formatDateTime(log.clockInTime)}</div>
                            {log.clockOutTime && (
                              <div className="text-rose-700 font-semibold">Out: {formatDateTime(log.clockOutTime)}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-extrabold text-amber-800">
                            {calculateDurationHours(log.clockInTime, log.clockOutTime)} Jam
                          </td>
                          <td className="py-3 px-4 text-[10px]">
                            {log.clockInGeo ? (
                              <div className="space-y-0.5">
                                <div className="flex items-center space-x-1 font-sans">
                                  <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
                                  <span className="font-bold">{log.clockInGeo.locationName || 'GPS Location'}</span>
                                </div>
                                <div className="text-slate-500">
                                  Jarak: {log.clockInGeo.distanceFromBranchMeters || 0}m (
                                  {log.clockInGeo.isWithinRadius ? 'Valid' : 'Luar Radius'})
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 font-sans italic">No Geo Data</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-500 italic font-sans">
                            {log.shiftNotes || '-'}
                          </td>
                          <td className="py-3 px-4 text-right font-sans">
                            <span
                              className={`px-2 py-0.5 rounded-full font-extrabold text-[10px] ${
                                log.status === 'CLOCKED_IN'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {log.status === 'CLOCKED_IN' ? '● ONLINE' : '○ FINISHED'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
