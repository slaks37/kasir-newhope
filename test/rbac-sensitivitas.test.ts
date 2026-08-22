/**
 * Kepekaan sumber daya menentukan audit dan kewajiban alasan — bukan peran.
 *
 * MURNI, tanpa database. Yang dijaga di sini keputusan izinnya, dan keputusan
 * izin yang salah tidak menimbulkan galat: ia hanya membuka sesuatu kepada
 * orang yang seharusnya tidak melihatnya, diam-diam.
 */

import { describe, it, expect } from 'vitest';
import {
  internalCapabilities,
  requiresAudit,
  requiresJustification,
  sensitivity,
  AUDITED_CAPABILITIES,
  type InternalCapability,
} from '../src/lib/rbac/environments';

describe('pemecahan VIEW_MERCHANT_DETAIL', () => {
  it('capability lama sudah tidak ada lagi', () => {
    const semua = internalCapabilities('ROLE_SUPERADMIN') as string[];
    expect(semua).not.toContain('VIEW_MERCHANT_DETAIL');
  });

  it('profil dan keuangan menjadi dua izin terpisah', () => {
    const sa = internalCapabilities('ROLE_SUPERADMIN');
    expect(sa).toContain('VIEW_MERCHANT_PROFILE');
    expect(sa).toContain('VIEW_MERCHANT_FINANCIAL');
    // Keduanya tidak sama pekanya, jadi tidak boleh diperlakukan sama.
    expect(sensitivity('VIEW_MERCHANT_PROFILE')).toBe('IDENTIFIED');
    expect(sensitivity('VIEW_MERCHANT_FINANCIAL')).toBe('FINANCIAL');
  });

  it('Growth tidak mendapat SATU PUN izin yang membidik satu merchant', () => {
    for (const cap of internalCapabilities('ROLE_INTERNAL_GROWTH')) {
      expect(sensitivity(cap), `${cap} bocor ke Growth`).toBe('AGGREGATE');
    }
  });

  it('Support tidak mendapat data pribadi pelanggan merchant', () => {
    expect(internalCapabilities('ROLE_INTERNAL_SUPPORT')).not.toContain('VIEW_CUSTOMER_DATA');
  });

  it('Support tidak bisa mengubah apa pun', () => {
    for (const cap of internalCapabilities('ROLE_INTERNAL_SUPPORT')) {
      expect(sensitivity(cap), `${cap} memberi Support kemampuan mengubah`).not.toBe('DANGEROUS');
    }
  });
});

describe('audit diturunkan dari kepekaan, bukan daftar tangan', () => {
  it('semua yang BUKAN agregat tercatat', () => {
    const sa = internalCapabilities('ROLE_SUPERADMIN');
    for (const cap of sa) {
      expect(requiresAudit(cap), cap).toBe(sensitivity(cap) !== 'AGGREGATE');
    }
  });

  it('agregat TIDAK dicatat — supaya jejaknya tetap berarti', () => {
    // Menuntut jejak untuk membuka dasbor ringkasan melatih staf mengabaikan
    // seluruh mekanismenya, dan kebiasaan itu merusak jejak yang penting.
    expect(requiresAudit('VIEW_SECTOR_ANALYTICS')).toBe(false);
    expect(requiresAudit('VIEW_PLATFORM_REVENUE')).toBe(false);
  });

  it('MANAGE_PUBLIC_CONTENT kini benar-benar tercatat', () => {
    // Sempat dicantumkan padahal blog belum punya sisi server, jadi tidak ada
    // permintaan yang bisa dicatat. Sekarang ada endpointnya.
    expect(AUDITED_CAPABILITIES).toContain('MANAGE_PUBLIC_CONTENT');
  });

  it('setiap capability punya kepekaan — tidak ada yang lolos tanpa dinilai', () => {
    const sa = internalCapabilities('ROLE_SUPERADMIN');
    for (const cap of sa) {
      expect(['AGGREGATE', 'IDENTIFIED', 'FINANCIAL', 'PERSONAL', 'DANGEROUS'])
        .toContain(sensitivity(cap));
    }
  });
});

describe('kewajiban alasan mengikuti DATA, bukan jabatan', () => {
  it('INI PERBAIKAN INTINYA: superadmin pun harus beralasan untuk data pribadi', () => {
    // Dulu: role === SUPPORT && requiresAudit(cap). Artinya superadmin membuka
    // data pribadi pelanggan tanpa menyebut alasan apa pun.
    expect(requiresJustification('ROLE_SUPERADMIN', 'VIEW_CUSTOMER_DATA')).toBe(true);
  });

  it('superadmin harus beralasan untuk setiap tindakan yang mengubah', () => {
    const berbahaya: InternalCapability[] = [
      'MANAGE_INTERNAL_USERS', 'IMPERSONATE_MERCHANT',
      'MANAGE_SUBSCRIPTION', 'GRANT_AI_CREDITS', 'MANAGE_PUBLIC_CONTENT',
    ];
    for (const cap of berbahaya) {
      expect(requiresJustification('ROLE_SUPERADMIN', cap), cap).toBe(true);
    }
  });

  it('superadmin TIDAK dituntut beralasan untuk membaca pembukuan platform', () => {
    // Ia memang mengurusnya. Menuntutnya setiap kali hanya melatih mengetik "cek".
    expect(requiresJustification('ROLE_SUPERADMIN', 'VIEW_TRANSACTION_LOG')).toBe(false);
    expect(requiresJustification('ROLE_SUPERADMIN', 'VIEW_MERCHANT_FINANCIAL')).toBe(false);
  });

  it('Support tetap harus beralasan untuk data satu merchant', () => {
    expect(requiresJustification('ROLE_INTERNAL_SUPPORT', 'VIEW_MERCHANT_PROFILE')).toBe(true);
    expect(requiresJustification('ROLE_INTERNAL_SUPPORT', 'VIEW_TRANSACTION_LOG')).toBe(true);
  });

  it('tidak ada yang dituntut beralasan untuk agregat', () => {
    for (const role of ['ROLE_SUPERADMIN', 'ROLE_INTERNAL_GROWTH', 'ROLE_INTERNAL_SUPPORT'] as const) {
      expect(requiresJustification(role, 'VIEW_SECTOR_ANALYTICS')).toBe(false);
    }
  });
});
