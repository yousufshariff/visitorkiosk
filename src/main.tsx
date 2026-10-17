import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHttpKioskApi } from '../client/HttpKioskApi';
import { KioskApp } from '../client/KioskApp';
import './index.css';

const root = createRoot(document.getElementById('root')!);
const key = import.meta.env.VITE_KIOSK_KEY;

if (!key) {
  root.render(
    <div role="alert" className="flex h-full items-center justify-center p-10 text-center text-2xl text-red-700">
      This kiosk is not configured (missing VITE_KIOSK_KEY). Please contact IT.
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <KioskApp api={createHttpKioskApi({ key })} />
    </StrictMode>,
  );
}
