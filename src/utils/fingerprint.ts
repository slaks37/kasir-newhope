import fpPromise from '@fingerprintjs/fingerprintjs';

// Cache the fingerprint promise
const fp = fpPromise.load();

export async function getDeviceId(): Promise<string> {
  try {
    const instance = await fp;
    const result = await instance.get();
    return result.visitorId;
  } catch (error) {
    console.error('Gagal mendapatkan device fingerprint:', error);
    // Fallback: generate a random uuid or use localstorage
    let fallbackId = localStorage.getItem('pos_fallback_device_id');
    if (!fallbackId) {
      fallbackId = `fallback-${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('pos_fallback_device_id', fallbackId);
    }
    return fallbackId;
  }
}
