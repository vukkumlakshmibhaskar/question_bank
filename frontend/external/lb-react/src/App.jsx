import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Parser from './pages/Parser';
import LanguageParser from './pages/LanguageParser';
import QuestionCrafter from './pages/QuestionCrafter';
import ToolHub from './pages/ToolHub';

export default function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<ToolHub />} />
        <Route path="/standard" element={<Parser />} />
        <Route path="/language" element={<LanguageParser />} />
        <Route path="/question-crafter" element={<QuestionCrafter />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
