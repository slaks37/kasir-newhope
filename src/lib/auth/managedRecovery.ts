export function recoveryEmail(value:string){
 const email=value.trim();
 return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';
}

export function verificationCode(value:string){
 const code=value.trim();
 // Managed verification codes are numeric. Never guess, truncate or strip
 // embedded characters from a code, or submit a pasted password/email.
 return /^[0-9]{1,32}$/.test(code)?code:'';
}

export function verificationFailure(error:unknown){
 const message=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';
 if(/expired/i.test(message))return 'Kode sudah kedaluwarsa. Minta kode baru hanya jika Anda siap memasukkannya langsung.';
 if(/invalid.*otp|otp.*invalid/i.test(message))return 'Kode tidak cocok dengan email ini. Periksa alamat email dan kode dari pesan terbaru, bukan password atau pesan lama.';
 return 'Verifikasi belum berhasil. Periksa email dan kode, lalu coba lagi secara manual.';
}
