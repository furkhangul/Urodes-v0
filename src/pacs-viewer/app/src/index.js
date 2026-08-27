// src/index.js içeriği
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Dosya ismin 'app.js' olduğu için küçük harf olmalı

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);