import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Parser from './pages/Parser';
import LanguageParser from './pages/LanguageParser'; 

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/standard" replace />} />
        <Route path="/standard" element={<Parser />} />
        <Route path="/language" element={<LanguageParser />} />
      </Routes>
    </Router>
  );
}