# Satu image untuk kelima service. Yang membedakan hanya perintah yang
# dijalankan (lihat docker-compose.yml).
#
# Image terpisah per service akan lebih kecil, tapi semuanya berbagi src/types,
# src/lib/assistant, dan services/shared — memecahnya berarti membangun lima
# kali untuk kode yang 80% sama, dan membuka peluang lima service berjalan pada
# versi kontrak yang berbeda.

FROM node:22-alpine

WORKDIR /app

# Dependensi lebih dulu, terpisah dari kode: lapisan ini hanya dibangun ulang
# saat package.json berubah, bukan setiap kali satu baris kode disunting.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Membangun aset SPA. Gateway menyajikannya di NODE_ENV=production; service lain
# mengabaikannya. Dibangun sekali di sini supaya gateway tidak perlu menjalankan
# Vite saat start.
RUN npx vite build

# Nilai default; docker-compose menimpanya per service.
ENV NODE_ENV=production
EXPOSE 3000 3101 3102 3103 3104

# Node menjalankan PID 1 di kontainer. Tanpa init, SIGTERM tidak diteruskan ke
# proses anak dan `docker compose down` akan menunggu sampai batas waktu lalu
# membunuh paksa — memutus transaksi yang sedang berjalan.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["npx", "tsx", "services/gateway/index.ts"]
