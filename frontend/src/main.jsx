import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import './styles.css';
import AdminPage from './admin/AdminPage.jsx';
import ReviewPage from './review/ReviewPage.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/r/:token" element={<ReviewPage />} />
        <Route path="*" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
