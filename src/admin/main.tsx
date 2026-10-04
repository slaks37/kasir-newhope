import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../styles/app-theme.css';
import AdminApp from './AdminApp';
import { Notifier } from '../components/ui/Notifier';

const el = document.getElementById('admin-root');
if (!el) throw new Error('#admin-root tidak ditemukan di admin.html');

createRoot(el).render(
  <StrictMode>
    <AdminApp />
    <Notifier />
  </StrictMode>
);
