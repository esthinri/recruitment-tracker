import React from 'react';
import { createRoot } from 'react-dom/client';
import '@coreui/coreui/dist/css/coreui.min.css';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><div data-coreui-theme="light"><App /></div></React.StrictMode>);
