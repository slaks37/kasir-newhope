import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import AdminApp from './AdminApp';

const el = document.getElementById('admin-root');
if (!el) throw new Error('#admin-root tidak ditemukan di admin.html');

createRoot(el).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
);
