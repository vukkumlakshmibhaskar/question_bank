import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import {
  Upload, Play, Download, Trash2, Loader2,
  Activity, Square, AlertTriangle, Plus,
  Crop, X, Database, CheckCircle2, UploadCloud,
  Undo, Redo, Eye, Check, FolderUp, RefreshCw, Key, Power,
  ZoomIn, ZoomOut, Clock, SkipForward, ScanText,
  Replace, BarChart2, Columns, Filter, ImageIcon, ShieldCheck,
  ChevronLeft, ChevronRight, List, MoreHorizontal
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import katex from 'katex';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useNavigate } from 'react-router-dom';

const resolveApiBase = (envValue, productionPath, localFallback) => (
  envValue ||
  (window.location.protocol === 'https:' ? productionPath : localFallback)
).replace(/\/+$/, '');

const API_BASE = resolveApiBase(
  import.meta.env.VITE_STANDARD_API_BASE,
  '/standard-api',
  'http://192.168.1.204:8070'
);
const ADS_WORKSPACE_ID_KEY = 'ads_browser_workspace_id';
const getAdsWorkspaceId = () => {
  try {
    let value = localStorage.getItem(ADS_WORKSPACE_ID_KEY);
    if (!value) {
      value = uuidv4();
      localStorage.setItem(ADS_WORKSPACE_ID_KEY, value);
    }
    return value;
  } catch {
    return `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};
axios.defaults.headers.common['X-ADS-Workspace-ID'] = getAdsWorkspaceId();

const cleanLogText = (text = '') => String(text)
  .replaceAll('â€”', '-')
  .replaceAll('â€“', '-')
  .replaceAll('â†³', '->')
  .replaceAll('âœ…', 'Done')
  .replaceAll('âœ“', 'Done')
  .replaceAll('âŒ', 'Error')
  .replaceAll('âš ï¸', 'Warning')
  .replaceAll('â³', 'Retrying')
  .replaceAll('ðŸ“¡', '')
  .replaceAll('ðŸ”', '')
  .replaceAll('ðŸ”„', '')
  .replaceAll('ðŸ›‘', '')
  .replaceAll('ðŸ†', '')
  .replaceAll('Â', '')
  .replace(/\b(?:gemini|gpt|openai|mistral)[-\w.]*/gi, 'processing service')
  .replace(/\b(?:Flash|Pro)\b/g, 'processor')
  .trim();

const normalizeRowIdentityValue = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const rowFingerprint = (row = {}) => [
  row['SET Name'],
  row['NIOS Filename'],
  row['Sl.No'] || row['Question Number'] || row.question_number,
  row['Page_Number'] || row.page_number,
].map(normalizeRowIdentityValue).join('|');

const hashString = (value) => {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
};

const stableRowId = (jobId, setName, row, rowIndex) => (
  row.id || `${jobId}-${setName}-${hashString(rowFingerprint(row) || rowIndex)}`
);

const repairDuplicateQuestionNumbers = (rows = []) => {
  const repaired = [];
  rows.forEach((row) => {
    const fixed = { ...row };
    const setName = String(fixed['SET Name'] || 'A').trim().toUpperCase();
    const proposed = String(fixed['Sl.No'] || '').trim();
    const existing = new Set(
      repaired
        .filter(item => String(item['SET Name'] || 'A').trim().toUpperCase() === setName)
        .map(item => String(item['Sl.No'] || '').trim().toLowerCase())
    );
    if (proposed && !existing.has(proposed.toLowerCase())) {
      repaired.push(fixed);
      return;
    }
    let nextNum = repaired.filter(item => String(item['SET Name'] || 'A').trim().toUpperCase() === setName).length + 1;
    while (existing.has(String(nextNum).toLowerCase())) nextNum += 1;
    fixed['Sl.No'] = String(nextNum);
    fixed['Repeat Question Id (Optional)'] = fixed['Repeat Question Id (Optional)'] || proposed;
    repaired.push(fixed);
  });
  return repaired;
};

const normalizeHeaderQuestionFields = (row = {}) => {
  const header = String(row['Question Header'] || '').trim();
  const question = String(row['Question text(Mandatory)'] || '').trim();
  if (!header) return row;
  const isLongHeader = header.length > 180 || header.split(/\r?\n/).filter(Boolean).length >= 2;
  const looksLikePassage = /\b(read|passage|paragraph|poem|extract|case study|answer the questions)\b/i.test(header);
  const looksLikeQuestion = /(\?|(?:^|\n)\s*(?:\(?[A-D]\)|[A-D]\.|\d+\s*[\).]))/i.test(header);
  if (isLongHeader && looksLikePassage) {
    const firstLine = header.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
    const shortHeader = firstLine.length > 120 ? 'Read the following passage and answer the questions.' : firstLine;
    return {
      ...row,
      'Question Header': shortHeader,
      'Question text(Mandatory)': `${header}${question ? `\n\n${question}` : ''}`.trim(),
    };
  }
  if ((isLongHeader || looksLikeQuestion) && (!question || question.length < 40)) {
    return {
      ...row,
      'Question Header': '',
      'Question text(Mandatory)': `${header}${question ? `\n\n${question}` : ''}`.trim(),
    };
  }
  if (question && header.toLowerCase() === question.toLowerCase()) {
    return { ...row, 'Question Header': '' };
  }
  return row;
};

const validateRowsForExport = (rows = []) => {
  const issues = [];
  const qnoCounts = new Map();
  rows.forEach((row) => {
    const qno = String(row['Sl.No'] || '').trim();
    if (qno) qnoCounts.set(qno, (qnoCounts.get(qno) || 0) + 1);
  });
  rows.forEach((row) => {
    const qno = String(row['Sl.No'] || '?').trim() || '?';
    const questionText = String(row['Question text(Mandatory)'] || '').trim();
    const questionLower = `${row['Question Header'] || ''} ${questionText}`.toLowerCase();
    const optionCount = parseInt(row['No. of Options/Blanks (Mandatory)'] || '0', 10);
    const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?', 'Option5 Is Correct?', 'Option6 Is Correct?'].some(col => row[col] === 'Yes');
    const needsImage = ['diagram', 'figure', 'image', 'map', 'graph'].some(word => questionLower.includes(word));
    const hasImage = !!String(row['If Question is Image, Specify Image Name'] || '').trim();
    if (!questionText) issues.push(`Q${qno}: missing question text`);
    if (optionCount > 0 && !hasCorrect) issues.push(`Q${qno}: missing correct answer`);
    if (needsImage && !hasImage) issues.push(`Q${qno}: mentions diagram/figure/image but has no question image`);
    if (qno && qnoCounts.get(qno) > 1 && !qno.toUpperCase().includes('_OR')) issues.push(`Q${qno}: duplicate question number`);
    if (row['Is_Verified'] !== 'Yes') issues.push(`Q${qno}: not verified`);
  });
  return [...new Set(issues)];
};

const DEFAULT_COLUMNS = [
  'Sl.No', 'Class', 'Subject Name', 'Subject Code', 'SET Name',
  'Lesson/Module', 'Chapter', 'Translate Language',
  'Question Mode (Mandatory)', 'Question text(Mandatory)', 'Question Type (Mandatory)',
  'Question Translate', 'Question Translate Image', 'If Question is Image, Specify Image Name',
  'Marks (Mandatory)', 'Negative Marks', 'No. of Options/Blanks (Mandatory)', 'Repeat Question Id (Optional)',
  'Option1 Mode (Mandatory)', 'Option1 (Mandatory)', 'Option1 Translate', 'Option1 Translate Image', 'If Option1 is Image, Specify Image Name', 'Option1 Is Correct?',
  'Option2 Mode (Mandatory)', 'Option2 (Mandatory)', 'Option2 Translate', 'Option2 Translate Image', 'If Option2 is Image, Specify Image Name', 'Option2 Is Correct?',
  'Option3 Mode (Mandatory)', 'Option3 (Mandatory)', 'Option3 Translate', 'Option3 Translate Image', 'If Option3 is Image, Specify Image Name', 'Option3 Is Correct?',
  'Option4 Mode (Mandatory)', 'Option4 (Mandatory)', 'Option4 Translate', 'Option4 Translate Image', 'If Option4 is Image, Specify Image Name', 'Option4 Is Correct?',
  'Option5 Mode (Mandatory)', 'Option5 (Mandatory)', 'Option5 Translate', 'Option5 Translate Image', 'If Option5 is Image, Specify Image Name', 'Option5 Is Correct?',
  'Option6 Mode (Mandatory)', 'Option6 (Mandatory)', 'Option6 Translate', 'Option6 Translate Image', 'If Option6 is Image, Specify Image Name', 'Option6 Is Correct?',
  'IsNestedMainQuestionType', 'NoofNestedQuestions', 'Parent Question No(if it is nested sub question)',
  'NIOS Filename', 'Question Complexity', 'Objective Type Questions', 'Question Header',
  'Answer_Diagram_Image', "Bloom's Taxonomy", 'Type of question (Mandatory)',
  'Duplicate_Flag', 'MS_Diagram_Flag', 'Page_Number', 'Page_Image_URL', 'MS_Page_Image_URL',
  'Extraction_Confidence', 'QP_Confidence', 'MS_Confidence', 'Is_Verified', 'id'
];

const VERIFY_MODE_COLUMNS = [
  'Sl.No', 'SET Name', 'Marks (Mandatory)',
  "Bloom's Taxonomy",
  'Question Header',
  'Question text(Mandatory)',
  'If Question is Image, Specify Image Name',
  'Option1 (Mandatory)', 'Option1 Is Correct?',
  'Option2 (Mandatory)', 'Option2 Is Correct?',
  'Option3 (Mandatory)', 'Option3 Is Correct?',
  'Option4 (Mandatory)', 'Option4 Is Correct?',
  'Answer_Diagram_Image', 'Extraction_Confidence', 'Is_Verified'
];

const HIDDEN_ALWAYS = new Set([
  'Duplicate_Flag', 'MS_Diagram_Flag', 'Page_Number', 'Page_Image_URL',
  'MS_Page_Image_URL', 'id', 'QP_Confidence', 'MS_Confidence'
]);

const QUESTION_TYPES = [
  "1 Mark (MCQ)",
  "Objective Type Questions",
  "Very Short Answer (VSA)",
  "Short Answer (SA)",
  "Long Answer Type (LA)",
  "Skill (Map)"
];

const BLOOM_TAXONOMY_OPTIONS = ['Knowledge', 'Understanding', 'Application'];

const INITIAL_INSTRUCTIONS = [
  { type: 'system_control', text: 'ENGINE READY: Awaiting Document Ingestion.' },
  { type: 'info', text: '1. Load structural matching files into the Master Queue.' },
  { type: 'info', text: '2. Execute "Run Queue" to begin continuous processing.' }
];

const getConfidenceColor = (score) => {
  const n = parseInt(score || 75);
  if (n >= 80) return { bg: '#dcfce7', border: '#86efac', text: '#166534', label: 'High' };
  if (n >= 60) return { bg: '#fef9c3', border: '#fde047', text: '#713f12', label: 'Med' };
  return { bg: '#fee2e2', border: '#fca5a5', text: '#7f1d1d', label: 'Low' };
};

const ConfidenceBadge = ({ score }) => {
  const c = getConfidenceColor(score);
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 700,
      display: 'inline-block', minWidth: 36, textAlign: 'center'
    }}>{score || 'â€”'}</span>
  );
};

const ProgressRing = ({ verified, total, size = 22 }) => {
  const pct = total > 0 ? verified / total : 0;
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const color = pct >= 0.9 ? '#22c55e' : pct >= 0.5 ? '#eab308' : '#ef4444';
  return (
    <svg width={size} height={size} style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={3} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
};

const formatTextWithMath = (text) => {
  if (text === null || text === undefined) return "";
  const safeText = String(text);
  const parts = safeText.split(/(\$.*?\$)/g);
  return parts.map((part, index) => {
    if (part.startsWith('$') && part.endsWith('$')) {
      const math = part.slice(1, -1);
      try {
        return <span key={index} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { throwOnError: false }) }} />;
      } catch (e) {
        return <span key={index}>{part}</span>;
      }
    }
    return <span key={index}>{part}</span>;
  });
};

const getAccurateImageUrl = (rowData, source, pageNum, jobId) => {
  if (!rowData) return '';
  const targetUrlStr = source === 'QP' ? rowData['Page_Image_URL'] : rowData['MS_Page_Image_URL'];
  if (targetUrlStr && targetUrlStr.includes('page_')) {
    const fixedPath = targetUrlStr.replace(/page_\d+\.png/, `page_${pageNum}.png`);
    return `${API_BASE}${fixedPath}`;
  }
  const baseName = rowData['NIOS Filename']
    ? String(rowData['NIOS Filename']).replace(/^(?:qp|ms|QP|MS)_/i, '').replace(/_[a-zA-Z0-9]{15,}\.pdf$/i, '').replace('.pdf', '')
    : 'Document';
  const prefix = source === 'QP' ? 'page_' : 'ms_page_';
  const folder = source === 'QP' ? 'ui_pages' : 'ms_ui_pages';
  return `${API_BASE}/workspace/${jobId}/${folder}/${baseName}/${prefix}${pageNum}.png`;
};

const CleanDataRow = React.memo(({ row, onSelect, isSelected }) => {
  const numOpts = parseInt(row['No. of Options/Blanks (Mandatory)'] || '0', 10);
  const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?'].some(c => row[c] === 'Yes');
  const isDuplicateTarget = (numOpts > 0 && !hasCorrect) || row['Duplicate_Flag'] === 'Yes';
  const isVerified = row['Is_Verified'] === 'Yes';
  const conf = parseInt(row['Extraction_Confidence'] || 75);
  const questionHeader = String(row['Question Header'] || '').trim();

  let rowClass = "border-b border-slate-200 cursor-pointer transition-colors text-sm hover:bg-slate-50 ";
  if (isSelected) rowClass += "bg-blue-50 border-l-4 border-blue-500 ";
  else if (isDuplicateTarget) rowClass += "bg-amber-50 hover:bg-amber-100 border-l-4 border-amber-400 ";
  else if (isVerified) rowClass += "bg-emerald-50/40 hover:bg-emerald-50/60 ";
  else if (conf < 60) rowClass += "bg-orange-50/40 hover:bg-orange-50 ";

  return (
    <tr className={rowClass} onClick={() => onSelect(row.id)}>
      <td className="p-4 font-mono text-slate-500 font-bold w-16 text-center">{row['Sl.No']}</td>
      <td className="p-4 text-slate-800 max-w-[500px]">
        {questionHeader && <div className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mb-1.5 line-clamp-1">{questionHeader}</div>}
        <div className="font-medium line-clamp-2">{row['Question text(Mandatory)']}</div>
        {numOpts > 0 && (
          <div className="text-xs text-slate-400 truncate mt-1.5 flex gap-4">
            {[1, 2, 3, 4].map(n => {
              const optText = row[`Option${n} (Mandatory)`];
              const isOptCorrect = row[`Option${n} Is Correct?`] === 'Yes';
              if (!optText) return null;
              return (
                <span key={n} className={isOptCorrect ? 'text-emerald-600 font-bold bg-emerald-50 px-1.5 rounded' : ''}>
                  {['A', 'B', 'C', 'D'][n - 1]}. {optText}
                </span>
              );
            })}
          </div>
        )}
      </td>
      <td className="p-4 w-40">
        <div className="flex items-center gap-3">
          {isVerified && <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded shadow-sm"><CheckCircle2 className="w-3 h-3" /> Verified</span>}
          {isDuplicateTarget && <span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-200 px-2 py-1 rounded shadow-sm animate-pulse"><AlertTriangle className="w-3 h-3" /> Flagged</span>}
          {!isVerified && !isDuplicateTarget && <span className="flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded shadow-sm">{conf}% Conf</span>}
        </div>
      </td>
      <td className="p-4 text-right w-24">
        <button className="text-blue-600 font-bold text-xs bg-white border border-blue-200 shadow-sm hover:bg-blue-600 hover:text-white px-3 py-1.5 rounded transition-colors">
          Edit &rarr;
        </button>
      </td>
    </tr>
  );
});

const ImagePreviewModal = ({ isOpen, imageUrl, jobId, baseName, onClose }) => {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [imageUrl, isOpen]);
  if (!isOpen || !imageUrl || !jobId) return null;
  const safeBaseName = baseName ? String(baseName).replace('.pdf', '') : 'Document';
  const fullPath = `${API_BASE}/workspace/${jobId}/images/${safeBaseName}/${imageUrl}?t=${Date.now()}`;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4">
      <div className="bg-[#0f172a] rounded-xl shadow-2xl p-6 flex flex-col items-center max-w-4xl max-h-[90vh] border border-slate-700">
        <h3 className="font-bold text-lg text-slate-200 w-full border-b border-slate-700 pb-3 mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5 text-cyan-400" /> Image Preview
        </h3>
        {!imgError
          ? <img src={fullPath} onError={() => setImgError(true)} alt="Preview" className="max-w-full max-h-[60vh] object-contain mb-6 shadow-sm border border-slate-600 rounded bg-black/50" />
          : <div className="flex flex-col items-center justify-center text-slate-400 bg-slate-800/50 p-12 rounded-xl border border-slate-700 mb-6 w-full">
            <AlertTriangle className="w-10 h-10 mb-2 text-amber-400" />
            <p className="font-bold text-slate-300">Image not found on server.</p>
          </div>
        }
        <button onClick={onClose} className="px-8 py-3 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-600 shadow-md transition-all w-full">Close</button>
      </div>
    </div>
  );
};

const FindReplaceModal = ({ isOpen, onClose, activeData, visibleColumns, onApply }) => {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [targetColumn, setTargetColumn] = useState('Question text(Mandatory)');
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!findText || !activeData) { setMatchCount(0); setError(''); return; }
    try {
      const pattern = useRegex ? new RegExp(findText, 'gi') : null;
      let count = 0;
      activeData.forEach(row => {
        const val = String(row[targetColumn] || '');
        if (useRegex) { const m = val.match(pattern); if (m) count += m.length; }
        else { let s = val.toLowerCase(), lf = findText.toLowerCase(), i; while ((i = s.indexOf(lf)) !== -1) { count++; s = s.slice(i + lf.length); } }
      });
      setMatchCount(count); setError('');
    } catch (e) { setError('Invalid regex: ' + e.message); setMatchCount(0); }
  }, [findText, targetColumn, useRegex, activeData]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-7 w-full max-w-lg border border-slate-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Replace className="w-5 h-5 text-indigo-500" />Global Find & Replace</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Target Column</label>
            <select value={targetColumn} onChange={e => setTargetColumn(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-indigo-400">
              {visibleColumns.filter(c => !HIDDEN_ALWAYS.has(c)).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Find</label>
            <input value={findText} onChange={e => setFindText(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Replace with</label>
            <input value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="Leave empty to delete matches" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" checked={useRegex} onChange={e => setUseRegex(e.target.checked)} className="rounded" />Use Regular Expression
          </label>
          {error && <p className="text-xs text-rose-600 font-bold">{error}</p>}
          {findText && !error && <p className="text-xs font-bold text-slate-500">Found <span className="text-indigo-600">{matchCount}</span> match(es)</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
          <button onClick={onClose} className="px-5 py-2.5 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => { onApply(findText, replaceText, targetColumn, useRegex); onClose(); }}
            disabled={!findText || !!error || matchCount === 0}
            className="px-7 py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 shadow-md">
            <Replace className="w-4 h-4" /> Replace All ({matchCount})
          </button>
        </div>
      </div>
    </div>
  );
};

const TextScannerModal = ({ isOpen, onClose, rowData, columnToUpdate, jobId, onScanComplete }) => {
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedText, setScannedText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [cropSource, setCropSource] = useState('QP');
  const [imgError, setImgError] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => { if (isOpen) setCropSource('QP'); }, [isOpen, rowData]);
  useEffect(() => {
    if (isOpen && rowData) {
      setCrop(undefined); setCompletedCrop(null); setImgError(false); setZoom(100); setScannedText('');
      const targetUrlStr = cropSource === 'QP' ? rowData['Page_Image_URL'] : rowData['MS_Page_Image_URL'];
      const match = targetUrlStr ? String(targetUrlStr).match(/page_(\d+)\.png/) : null;
      setCurrentPage(match ? parseInt(match[1]) : 1);
    }
  }, [isOpen, rowData, cropSource]);

  if (!isOpen || !rowData || !jobId) return null;
  const currentImageUrl = getAccurateImageUrl(rowData, cropSource, currentPage, jobId);
  const targetLabel = columnToUpdate === 'Question Header'
    ? 'Question Header / Passage'
    : columnToUpdate === 'Question text(Mandatory)'
      ? 'Question Text'
      : columnToUpdate;

  const handleScan = async () => {
    if (!completedCrop || !imgRef.current || completedCrop.width === 0 || completedCrop.height === 0) {
      alert("Please draw a crop box around the text first.");
      return;
    }
    setIsScanning(true);
    try {
      const canvas = document.createElement('canvas');
      const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
      const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
      canvas.width = completedCrop.width; canvas.height = completedCrop.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgRef.current, completedCrop.x * scaleX, completedCrop.y * scaleY, completedCrop.width * scaleX, completedCrop.height * scaleY, 0, 0, completedCrop.width, completedCrop.height);
      canvas.toBlob(async (blob) => {
        if (!blob) throw new Error('Crop image could not be created');
        const form = new FormData();
        form.append('image', blob, 'scan.png');
        form.append('language', 'English');
        form.append('direction', 'ltr');
        form.append('script', 'Latin');
        const res = await fetch(`${API_BASE}/scan-text`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setScannedText((json.text || '').trim());
        setIsScanning(false);
      }, 'image/png');
    } catch (e) { alert(`OCR Engine Failed: ${e.message || e}`); setIsScanning(false); }
  };

  const applyScan = (mode) => {
    const extracted = scannedText.trim();
    if (!extracted) return;
    const currentValue = String(rowData?.[columnToUpdate] || '').trim();
    const nextValue = mode === 'append' && currentValue ? `${currentValue}\n${extracted}` : extracted;
    onScanComplete(nextValue, rowData.id, columnToUpdate);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
      <div className="bg-[#0f172a] rounded-xl shadow-2xl border border-cyan-700 w-full max-w-6xl flex flex-col max-h-[95vh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700 bg-slate-900/50 flex-shrink-0">
          <div className="flex items-center gap-6">
            <h3 className="font-bold text-lg text-slate-200 flex items-center gap-2"><ScanText className="w-5 h-5 text-cyan-400" /> AI OCR Scanner</h3>
            <div className="bg-rose-500/80 text-white text-[11px] font-black px-3 py-1 rounded shadow-lg uppercase tracking-widest">Targeting: Q{rowData['Sl.No']}</div>
            <div className="bg-cyan-500/15 text-cyan-200 text-[11px] font-black px-3 py-1 rounded border border-cyan-500/30 uppercase tracking-widest">Field: {targetLabel}</div>
            <div className="inline-flex items-center gap-2 bg-black/40 border border-slate-700 p-1 rounded-lg">
              <button onClick={() => setCropSource('QP')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${cropSource === 'QP' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>QP</button>
              <button onClick={() => setCropSource('MS')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${cropSource === 'MS' ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>MS</button>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-slate-700 rounded-lg px-2 py-1">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="p-1 hover:bg-slate-700 rounded text-slate-300">&larr;</button>
              <span className="text-xs font-bold text-slate-200 min-w-[50px] text-center">Pg {currentPage}</span>
              <button onClick={() => setCurrentPage(p => p + 1)} className="p-1 hover:bg-slate-700 rounded text-slate-300">&rarr;</button>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-slate-700 rounded-lg px-2 py-1">
              <button onClick={() => setZoom(z => Math.max(50, z - 25))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomOut className="w-4 h-4" /></button>
              <button onClick={() => setZoom(z => Math.min(300, z + 25))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomIn className="w-4 h-4" /></button>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-rose-400 rounded-lg"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-auto bg-black/20 p-6 flex justify-center items-start min-h-0 custom-scrollbar shadow-inner">
          {!imgError
            ? <div style={{ width: `${1000 * (zoom / 100)}px`, transition: 'width 0.2s ease-out' }}>
              <ReactCrop crop={crop} onChange={(_, pc) => setCrop(pc)} onComplete={(c) => setCompletedCrop(c)} className="shadow-2xl rounded bg-white w-full block border border-cyan-600">
                <img ref={imgRef} src={currentImageUrl} onError={() => setImgError(true)} alt="Document Segment" className="w-full h-auto block pointer-events-none select-none" crossOrigin="anonymous" />
              </ReactCrop>
            </div>
            : <div className="flex flex-col items-center justify-center text-slate-400">
              <AlertTriangle className="w-12 h-12 mb-3 text-amber-400" />
              <p className="font-bold text-lg text-slate-300">No Image Source Available</p>
            </div>
          }
        </div>
        {scannedText && (
          <div className="border-t border-slate-700 bg-slate-950/70 px-6 py-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-cyan-300">Scanned text preview</div>
            <textarea value={scannedText} onChange={(e) => setScannedText(e.target.value)}
              className="h-24 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 outline-none focus:border-cyan-500" />
          </div>
        )}
        <div className="px-6 py-4 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-6 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg">Cancel</button>
          {scannedText && <button onClick={() => applyScan('replace')} className="px-5 py-3 text-amber-200 font-bold hover:bg-amber-950/40 rounded-lg border border-amber-800/70">Replace</button>}
          {scannedText && <button onClick={() => applyScan('append')} className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500">Append</button>}
          <button onClick={handleScan} disabled={!completedCrop || completedCrop.width === 0 || isScanning}
            className="px-8 py-3 bg-cyan-600/80 text-white font-bold text-lg rounded-lg hover:bg-cyan-500 flex items-center gap-2 disabled:opacity-50 shadow-lg">
            {isScanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanText className="w-5 h-5" />} {scannedText ? 'Scan Again' : 'Extract Text'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ManualCropModal = ({ isOpen, onClose, rowData, columnToUpdate, jobId, onCropComplete }) => {
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cropSource, setCropSource] = useState('QP');
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [imgError, setImgError] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => { if (isOpen) setCropSource('QP'); }, [isOpen, rowData]);
  useEffect(() => {
    if (isOpen && rowData) {
      setCrop(undefined); setCompletedCrop(null); setImgError(false); setZoom(100);
      const targetUrlStr = cropSource === 'QP' ? rowData['Page_Image_URL'] : rowData['MS_Page_Image_URL'];
      const match = targetUrlStr ? String(targetUrlStr).match(/page_(\d+)\.png/) : null;
      setCurrentPage(match ? parseInt(match[1]) : 1);
    }
  }, [isOpen, rowData, cropSource]);

  if (!isOpen || !rowData || !jobId) return null;
  const currentImageUrl = getAccurateImageUrl(rowData, cropSource, currentPage, jobId);

  const handleUploadCrop = async () => {
    if (!completedCrop || !imgRef.current) return;
    setIsUploading(true);
    try {
      const canvas = document.createElement('canvas');
      const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
      const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
      canvas.width = completedCrop.width; canvas.height = completedCrop.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgRef.current, completedCrop.x * scaleX, completedCrop.y * scaleY, completedCrop.width * scaleX, completedCrop.height * scaleY, 0, 0, completedCrop.width, completedCrop.height);
      canvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append("file", new File([blob], 'crop.png', { type: 'image/png' }));
        formData.append("q_sno", String(rowData['Sl.No'] || 'Unknown'));
        formData.append("set_name", String(rowData['SET Name'] || 'A'));
        formData.append("base_name", String(rowData['NIOS Filename'] || 'Document.pdf'));
        formData.append("field", columnToUpdate);
        formData.append("subject_code", String(rowData['Subject Code'] || ''));
        formData.append("source", cropSource);
        const res = await axios.post(`${API_BASE}/upload-manual-image/${jobId}`, formData);
        onCropComplete(res.data.filename, rowData.id, columnToUpdate);
        setIsUploading(false);
        onClose();
      }, 'image/png');
    } catch (e) { alert("Core processor failed to slice coordinates."); setIsUploading(false); }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
      <div className="bg-[#0f172a] rounded-xl shadow-2xl border border-slate-700 w-full max-w-6xl flex flex-col max-h-[95vh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700 bg-slate-900/50 flex-shrink-0">
          <div className="flex items-center gap-6">
            <h3 className="font-bold text-lg text-slate-200 flex items-center gap-2"><Crop className="w-5 h-5 text-cyan-400" /> Manual Crop</h3>
            <div className="bg-emerald-500/80 text-white text-[11px] font-black px-3 py-1 rounded shadow-lg uppercase tracking-widest">Targeting: Q{rowData['Sl.No']}</div>
            <div className="inline-flex items-center gap-2 bg-black/40 border border-slate-700 p-1 rounded-lg">
              <button onClick={() => setCropSource('QP')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${cropSource === 'QP' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Question Paper</button>
              <button onClick={() => setCropSource('MS')} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${cropSource === 'MS' ? 'bg-fuchsia-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Marking Scheme</button>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-slate-700 rounded-lg px-2 py-1">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="p-1 hover:bg-slate-700 rounded text-slate-300">&larr;</button>
              <span className="text-xs font-bold text-slate-200 min-w-[50px] text-center">Pg {currentPage}</span>
              <button onClick={() => setCurrentPage(p => p + 1)} className="p-1 hover:bg-slate-700 rounded text-slate-300">&rarr;</button>
            </div>
            <div className="flex items-center gap-2 bg-black/40 border border-slate-700 rounded-lg px-2 py-1">
              <button onClick={() => setZoom(z => Math.max(50, z - 25))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomOut className="w-4 h-4" /></button>
              <button onClick={() => setZoom(z => Math.min(300, z + 25))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomIn className="w-4 h-4" /></button>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-rose-400 rounded-lg"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-auto bg-black/20 p-6 flex justify-center items-start min-h-0 custom-scrollbar shadow-inner">
          {!imgError
            ? <div style={{ width: `${1000 * (zoom / 100)}px`, transition: 'width 0.2s ease-out' }}>
              <ReactCrop crop={crop} onChange={(_, pc) => setCrop(pc)} onComplete={(c) => setCompletedCrop(c)} className="shadow-2xl rounded bg-white w-full block border border-slate-600">
                <img ref={imgRef} src={currentImageUrl} onError={() => setImgError(true)} alt="Document Segment" className="w-full h-auto block pointer-events-none select-none" crossOrigin="anonymous" />
              </ReactCrop>
            </div>
            : <div className="flex flex-col items-center justify-center text-slate-400">
              <AlertTriangle className="w-12 h-12 mb-3 text-amber-400" />
              <p className="font-bold text-lg text-slate-300">No Image Source Available</p>
            </div>
          }
        </div>
        <div className="px-6 py-4 border-t border-slate-700 bg-slate-900/50 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-6 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg">Cancel</button>
          <button onClick={handleUploadCrop} disabled={!completedCrop || completedCrop.width === 0 || isUploading}
            className="px-8 py-3 bg-emerald-600/80 text-white font-bold text-lg rounded-lg hover:bg-emerald-500 flex items-center gap-2 disabled:opacity-50 shadow-lg">
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Confirm & Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
};

function VerifyDashboard({ isOpen, onClose, openModalAtId, activeData }) {
  const [activeSection, setActiveSection] = useState('critical');

  const errors = useMemo(() => {
    const critical = [], warnings = [], missing = [], duplicates = [], lowConf = [];
    if (!activeData || activeData.length === 0) return { critical, warnings, missing, duplicates, lowConf };

    activeData.forEach((row) => {
      const qText = (row['Question text(Mandatory)'] || '');
      if (qText.trim().length === 0) critical.push({ id: row.id, qno: row['Sl.No'], message: 'Missing Question Text' });

      const numOpts = parseInt(row['No. of Options/Blanks (Mandatory)'] || '0', 10);
      const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?'].some(col => row[col] === 'Yes');
      if (numOpts > 0 && !hasCorrect)
        critical.push({ id: row.id, qno: row['Sl.No'], message: 'No correct option selected' });

      const qTextLower = qText.toLowerCase();
      const hasMainImage = !!row['If Question is Image, Specify Image Name'];
      if (!hasMainImage && (qTextLower.includes('figure') || qTextLower.includes('diagram') || qTextLower.includes('image')))
        warnings.push({ id: row.id, qno: row['Sl.No'], message: "Text mentions 'figure/diagram', missing crop" });

      if (row['Duplicate_Flag'] === 'Yes')
        duplicates.push({ id: row.id, qno: row['Sl.No'], message: row['SET Name'] !== 'A' ? 'MS answer says "same as Set A"' : 'Flagged as duplicate' });

      const conf = parseInt(row['Extraction_Confidence'] || '75');
      if (conf < 60) lowConf.push({ id: row.id, qno: row['Sl.No'], message: `Low confidence: ${conf}` });
    });

    const existingQNos = activeData.map(r => { const s = String(r['Sl.No'] || ''); const m = s.match(/^(\d+)/); return m ? parseInt(m[1], 10) : NaN; }).filter(n => !isNaN(n));
    if (existingQNos.length > 0) {
      const uniqueQNos = [...new Set(existingQNos)].sort((a, b) => a - b);
      for (let i = 0; i < uniqueQNos.length - 1; i++) {
        for (let j = uniqueQNos[i] + 1; j < uniqueQNos[i + 1]; j++)
          missing.push({ id: null, qno: j, message: `Missing Question ${j} from the sequence` });
      }
    }
    return { critical, warnings, missing, duplicates, lowConf };
  }, [activeData]);

  const sections = [
    { key: 'critical', label: 'Critical', color: 'rose', items: errors.critical },
    { key: 'lowConf', label: 'Low Conf', color: 'orange', items: errors.lowConf },
    { key: 'warnings', label: 'Diagrams', color: 'amber', items: errors.warnings },
    { key: 'missing', label: 'Gaps', color: 'fuchsia', items: errors.missing },
    { key: 'duplicates', label: 'Dupes', color: 'blue', items: errors.duplicates },
  ];

  if (!isOpen) return null;
  const activeSec = sections.find(s => s.key === activeSection);

  return (
    <div onClick={e => e.stopPropagation()} className={`fixed inset-y-0 right-0 w-96 bg-white/95 backdrop-blur-2xl border-l border-slate-200 shadow-[0_0_50px_rgba(0,0,0,0.2)] z-[60] transform transition-transform duration-300 ease-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <h2 className="text-lg font-bold text-slate-800 flex items-center"><ShieldCheck className="mr-2 h-5 w-5 text-blue-600" /> Verification</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
      </div>
      <div className="flex border-b border-slate-200 overflow-x-auto flex-shrink-0">
        {sections.map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)}
            className={`flex-1 px-2 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${activeSection === s.key ? `border-${s.color}-500 text-${s.color}-700 bg-${s.color}-50` : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            {s.label}
            <span className={`ml-1 text-[10px] font-black px-1.5 py-0.5 rounded-full ${s.items.length > 0 ? `bg-${s.color}-100 text-${s.color}-700` : 'bg-slate-100 text-slate-400'}`}>{s.items.length}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {activeSec && activeSec.items.length === 0
          ? <p className="text-sm text-slate-400 italic text-center pt-8">No issues found.</p>
          : activeSec?.items.map((err, i) => (
            <button key={i} onClick={() => err.id && openModalAtId(err.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all shadow-sm ${err.id ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} bg-${activeSec.color}-50 border-${activeSec.color}-200`}>
              <span className={`font-mono font-bold text-${activeSec.color}-700 text-sm`}>Q{err.qno}</span>
              <span className={`block text-xs text-${activeSec.color}-600 mt-0.5`}>{err.message}</span>
            </button>
          ))
        }
      </div>
    </div>
  );
}

const PageList = React.memo(({ availablePages, cropSource, currentRow, jobId }) => (
  <div className="flex flex-col gap-4 pb-32 pt-4 px-4 w-full">
    {availablePages.map((pNum) => {
      const imgUrl = getAccurateImageUrl(currentRow, cropSource, pNum, jobId);
      return (
        <div key={`${cropSource}-${pNum}`} id={`doc-page-${pNum}`}
          className="relative w-full flex justify-center border border-slate-800 rounded shadow-[0_0_15px_rgba(0,0,0,0.5)] bg-white overflow-hidden"
          style={{ aspectRatio: '1 / 1.414', minHeight: '100px' }}>
          <div className="absolute top-1 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded z-20 font-mono">Page {pNum}</div>
          <img src={imgUrl} alt={`Page ${pNum}`} loading="lazy" decoding="async"
            className="w-full h-auto object-contain relative z-10"
            onError={(e) => { const c = document.getElementById(`doc-page-${pNum}`); if (c) c.style.display = 'none'; }}
            crossOrigin="anonymous" />
        </div>
      );
    })}
  </div>
), (prev, next) => prev.cropSource === next.cropSource && prev.jobId === next.jobId && prev.availablePages === next.availablePages);

// ==========================================
// REVIEW MODAL â€” all keyboard/navigation bugs fixed
// ==========================================
function ReviewModal({ isOpen, initialRowId, data, onClose, onUpdate, jobId, onImagePreview, onTriggerScanner, insertRow, deleteRow, flaggedIds }) {
  const [currentRowId, setCurrentRowId] = useState(initialRowId);
  const [cropSource, setCropSource] = useState('QP');
  const [previewZoom, setPreviewZoom] = useState(100);
  // FIX 3a: pendingNavigateId â€” waits for state to commit before navigating
  const [pendingNavigateId, setPendingNavigateId] = useState(null);
  const rightPanelRef = useRef(null);
  // FIX 2a: ref holds current index so keyboard handler never goes stale
  const currentIndexRef = useRef(-1);
  const lastGoodIndexRef = useRef(0);

  useEffect(() => {
    if (isOpen) { setCurrentRowId(initialRowId); setPreviewZoom(100); }
  }, [isOpen, initialRowId]);

  const currentIndex = useMemo(() => data ? data.findIndex(r => r.id === currentRowId) : -1, [data, currentRowId]);
  const currentRow = data && currentIndex >= 0 ? data[currentIndex] : null;

  // FIX 2b: keep refs in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex;
    if (currentIndex >= 0) lastGoodIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!isOpen || !data?.length || currentIndex !== -1) return;
    const safeIdx = Math.min(lastGoodIndexRef.current, data.length - 1);
    setCurrentRowId(data[safeIdx]?.id || data[0].id);
  }, [isOpen, data, currentIndex]);

  // FIX 3b: navigate once the new row appears in data
  useEffect(() => {
    if (!pendingNavigateId || !data) return;
    const found = data.find(r => r.id === pendingNavigateId);
    if (found) { goToId(pendingNavigateId); setPendingNavigateId(null); }
  }, [data, pendingNavigateId]);

  const goToId = useCallback((id) => {
    setCurrentRowId(id);
    rightPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goToIdx = useCallback((idx) => {
    if (!data || idx < 0 || idx >= data.length) return;
    goToId(data[idx].id);
  }, [data, goToId]);

  useEffect(() => {
    if (!isOpen || !currentRow) return;

    // QP mode: auto-scroll to the page containing the current question.
    // MS mode: do NOT auto-scroll â€” MS_Page_Image_URL is a distributed placeholder,
    // not a real answer location. The user scrolls the MS manually to find each answer.
    if (cropSource !== 'QP') return;

    const raf = requestAnimationFrame(() => {
      const url = currentRow['Page_Image_URL'];
      const match = url ? String(url).match(/page_(\d+)\.png/) : null;
      if (!match) return;
      const pNum = parseInt(match[1]);
      const container = document.getElementById('pdf-scroll-container');
      const pageEl = document.getElementById(`doc-page-${pNum}`);
      if (pageEl && container) container.scrollTo({ top: pageEl.offsetTop - 20, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [currentIndex, cropSource, isOpen]);

  const jumpToNextIssue = useCallback(() => {
    if (!flaggedIds || !flaggedIds.length || !data) return;
    const idList = flaggedIds.filter(id => data.some(r => r.id === id));
    if (!idList.length) return;
    const ci = idList.findIndex(id => id === currentRowId);
    goToId(idList[(ci + 1) % idList.length]);
  }, [flaggedIds, currentRowId, data, goToId]);

  const handleOptionToggle = useCallback((optNumber) => {
    if (!currentRow) return;
    const updates = { 'Option1 Is Correct?': 'No', 'Option2 Is Correct?': 'No', 'Option3 Is Correct?': 'No', 'Option4 Is Correct?': 'No' };
    updates[`Option${optNumber} Is Correct?`] = 'Yes';
    onUpdate(currentRow.id, updates);
  }, [currentRow, onUpdate]);

  const toggleVerified = useCallback(() => {
    if (!currentRow) return;
    const next = currentRow['Is_Verified'] === 'Yes' ? 'No' : 'Yes';
    onUpdate(currentRow.id, { 'Is_Verified': next });
    if (next === 'Yes' && data) {
      for (let i = currentIndex + 1; i < data.length; i++) {
        if (data[i]['Is_Verified'] !== 'Yes') { goToIdx(i); return; }
      }
    }
  }, [currentRow, currentIndex, data, onUpdate, goToIdx]);

  // FIX 2c: keyboard handler uses currentIndexRef â€” never stale
  // FIX 2d: dependency array excludes currentIndex and currentRow
  useEffect(() => {
    if (!isOpen || !data) return;
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      switch (e.key) {
        case 'ArrowDown': case 'ArrowRight':
          e.preventDefault(); goToIdx(currentIndexRef.current + 1); break;
        case 'ArrowUp': case 'ArrowLeft':
          e.preventDefault(); goToIdx(currentIndexRef.current - 1); break;
        case '1': case '2': case '3': case '4':
          e.preventDefault(); handleOptionToggle(parseInt(e.key)); break;
        case 'v': case 'V': e.preventDefault(); toggleVerified(); break;
        case 'j': case 'J': e.preventDefault(); jumpToNextIssue(); break;
        case 'd': case 'D':
          e.preventDefault();
          if (data && data[currentIndexRef.current]) onUpdate(data[currentIndexRef.current].id, { 'Duplicate_Flag': 'Yes' });
          break;
        case 'i': case 'I':
          e.preventDefault();
          if (data && data[currentIndexRef.current]) {
            // FIX 3c: use pendingNavigateId instead of setTimeout
            const newId = insertRow(data[currentIndexRef.current].id, 'below');
            if (newId) setPendingNavigateId(newId);
          }
          break;
        case 'c': case 'C':
          e.preventDefault();
          if (data && data[currentIndexRef.current]) onTriggerScanner('If Question is Image, Specify Image Name', 'crop_qp', data[currentIndexRef.current]);
          break;
        case 'Escape': onClose(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // FIX 2d: currentIndex and currentRow removed from deps â€” use ref instead
  }, [isOpen, data, goToIdx, handleOptionToggle, toggleVerified, jumpToNextIssue, onUpdate, insertRow, onTriggerScanner, onClose]);

  const availablePages = useMemo(() => {
    if (!data) return [];
    const pages = new Set();
    data.forEach(r => {
      const urlStr = cropSource === 'QP' ? r['Page_Image_URL'] : r['MS_Page_Image_URL'];
      const match = String(urlStr || '').match(/page_(\d+)\.png/);
      if (match) pages.add(parseInt(match[1]));
    });
    return Array.from(pages).sort((a, b) => a - b);
  }, [data, cropSource]);

  if (!isOpen || !data || data.length === 0 || !currentRow) return null;

  const handleFieldUpdate = (field, value) => onUpdate(currentRow.id, { [field]: value });
  const conf = parseInt(currentRow['Extraction_Confidence'] || 75);
  const confColor = getConfidenceColor(conf);
  const isVerified = currentRow['Is_Verified'] === 'Yes';
  const isFlagged = flaggedIds?.includes(currentRow.id);

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-6" onClick={(e) => e.stopPropagation()}>
      <div className="bg-[#0f172a]/95 border border-slate-700 w-full max-w-7xl h-[95vh] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden animate-fade-in">

        <div className={`px-4 py-2 border-b flex-shrink-0 ${isVerified ? 'border-emerald-700 bg-emerald-950/30' : 'border-slate-800 bg-slate-900/50'}`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="font-mono text-sm font-bold text-slate-400 shrink-0">Q {currentIndex + 1}/{data.length}</span>
              <button onClick={toggleVerified}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all shrink-0 ${isVerified ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-emerald-500 hover:text-emerald-400'}`}>
                <Check className="w-3.5 h-3.5" />{isVerified ? 'Verified' : 'Mark Verified'} <span className="opacity-60 text-[10px]">[V]</span>
              </button>
              {flaggedIds?.length > 0 && (
                <button onClick={jumpToNextIssue}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-600 bg-amber-900/30 text-amber-300 hover:bg-amber-800/40 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" />Next Issue <span className="opacity-60 text-[10px]">[J]</span>
                </button>
              )}
              {isFlagged && <span className="text-xs font-bold text-rose-400 bg-rose-950/50 border border-rose-700 px-2 py-1 rounded shrink-0">âš  Flagged</span>}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-800 bg-black/20 text-xs shrink-0">
                <span className="text-slate-500">Conf:</span>
                <span style={{ color: confColor.text, background: confColor.bg, padding: '1px 6px', borderRadius: 5, fontWeight: 700 }}>{conf}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => goToIdx(currentIndex - 1)} disabled={currentIndex <= 0}
                className="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-md text-sm border border-slate-600 flex items-center gap-1 disabled:opacity-30">
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-cyan-100 font-medium w-20 text-center text-sm shrink-0">{currentIndex + 1} / {data.length}</span>
              <button onClick={() => goToIdx(currentIndex + 1)} disabled={currentIndex >= data.length - 1}
                className="px-3 py-1.5 bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 rounded-md text-sm border border-blue-500/20 flex items-center gap-1 disabled:opacity-30">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <div className="w-px h-5 bg-slate-700 mx-0.5" />
              <button onClick={() => {
                if (currentRow) {
                  // FIX 3d: use pendingNavigateId for Add button too
                  const newId = insertRow(currentRow.id, 'below');
                  if (newId) setPendingNavigateId(newId);
                }
              }} className="px-3 py-1.5 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 rounded-md text-sm border border-emerald-500/20 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
              <button onClick={() => {
                if (window.confirm(`Delete Q${currentRow['Sl.No']}?`)) {
                  const remaining = data.filter(r => r.id !== currentRow.id);
                  const nextIdx = Math.min(currentIndex, remaining.length - 1);
                  const nextId = remaining[nextIdx]?.id || remaining[nextIdx - 1]?.id || null;
                  deleteRow(currentRow.id);
                  if (nextId) goToId(nextId);
                  else onClose();
                }
              }} className="px-3 py-1.5 bg-rose-600/20 text-rose-300 hover:bg-rose-600/40 rounded-md text-sm border border-rose-500/20 flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <div className="w-px h-5 bg-slate-700 mx-0.5" />
              <button onClick={onClose} className="px-2 py-1 text-slate-500 hover:text-rose-400 text-xl leading-none">&times;</button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-md border border-slate-800 shrink-0">
              <span className="text-xs text-slate-400">Marks:</span>
              <DebouncedWorkspaceInput type="number" value={currentRow['Marks (Mandatory)']} onChange={(val) => handleFieldUpdate('Marks (Mandatory)', val)}
                className="w-12 bg-transparent border-b border-slate-700 text-slate-200 focus:outline-none focus:border-blue-500 text-center text-sm" />
            </div>
            <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-md border border-slate-800 flex-1 min-w-0">
              <span className="text-xs text-slate-400 shrink-0">Type:</span>
              <select value={currentRow['Type of question (Mandatory)'] || ''} onChange={(e) => handleFieldUpdate('Type of question (Mandatory)', e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none text-sm cursor-pointer flex-1 min-w-0">
                <option value="" disabled className="bg-slate-800">Select Type</option>
                {QUESTION_TYPES.map(type => <option key={type} value={type} className="bg-slate-800">{type}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-md border border-slate-800 flex-1 min-w-0">
              <span className="text-xs text-slate-400 shrink-0">Bloom:</span>
              <select value={currentRow["Bloom's Taxonomy"] || ''} onChange={(e) => handleFieldUpdate("Bloom's Taxonomy", e.target.value)}
                className="bg-transparent text-slate-200 focus:outline-none text-sm cursor-pointer flex-1 min-w-0">
                <option value="" disabled className="bg-slate-800">Select Bloom</option>
                {BLOOM_TAXONOMY_OPTIONS.map(level => <option key={level} value={level} className="bg-slate-800">{level}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden bg-[#0B1120]/50">
          <div className="w-7/12 p-5 border-r border-slate-800/80 flex flex-col bg-slate-900/20 relative group">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500 uppercase tracking-widest font-semibold flex items-center">
                <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>Source Document
              </div>
              <div className="flex items-center gap-2 bg-black/40 border border-slate-700 p-1 rounded-lg">
                <button onClick={() => setPreviewZoom(z => Math.max(50, z - 25))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomOut className="w-4 h-4" /></button>
                <span className="text-xs font-bold text-slate-200 min-w-[40px] text-center">{previewZoom}%</span>
                <button onClick={() => setPreviewZoom(z => Math.min(300, z + 25))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomIn className="w-4 h-4" /></button>
                <div className="w-px h-4 bg-slate-600 mx-1"></div>
                <button onClick={() => setCropSource('QP')} className={`px-2 py-1 text-xs font-bold rounded-md border transition-colors ${cropSource === 'QP' ? 'bg-slate-700 text-blue-400 border-blue-500/50' : 'text-slate-500 border-transparent hover:bg-slate-800'}`}>QP</button>
                <button onClick={() => setCropSource('MS')} className={`px-2 py-1 text-xs font-bold rounded-md border transition-colors ${cropSource === 'MS' ? 'bg-slate-700 text-fuchsia-400 border-fuchsia-500/50' : 'text-slate-500 border-transparent hover:bg-slate-800'}`}>MS</button>
              </div>
            </div>
            <div className="flex-1 rounded-xl bg-slate-900/50 border border-slate-800/80 overflow-y-auto overflow-x-hidden shadow-inner relative custom-scrollbar scroll-smooth" id="pdf-scroll-container">
              <div style={{ width: `${previewZoom}%`, transition: 'width 0.2s ease-out', margin: '0 auto' }}>
                <PageList availablePages={availablePages} cropSource={cropSource} currentRow={currentRow} jobId={jobId} />
              </div>
            </div>
          </div>

          <div ref={rightPanelRef} className="w-5/12 p-7 overflow-y-auto bg-transparent flex flex-col custom-scrollbar gap-4">
            <div className="text-[10px] text-slate-600 font-mono bg-black/20 px-3 py-1.5 rounded border border-slate-800 flex-shrink-0">
              Arrow keys navigate · 1-4 options · V verify · J next issue · I insert · C crop · D dup · Esc close
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1 bg-blue-900/30 px-2 py-1 rounded-md border border-blue-800/50 font-mono text-sm font-bold text-blue-400">
                  <span>Q</span>
                  <DebouncedWorkspaceInput value={currentRow['Sl.No']} onChange={(val) => handleFieldUpdate('Sl.No', val)} className="w-10 bg-transparent text-center border-b border-transparent hover:border-blue-500 focus:border-blue-400 outline-none text-blue-300" />
                  <span className="text-slate-500 mx-1">|</span>
                  <span>Set</span>
                  <DebouncedWorkspaceInput value={currentRow['SET Name']} onChange={(val) => handleFieldUpdate('SET Name', val)} className="w-6 bg-transparent text-center border-b border-transparent hover:border-blue-500 focus:border-blue-400 outline-none text-blue-300 uppercase" />
                </div>
              </div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Question Header / Passage</label>
                <button onClick={() => onTriggerScanner('Question Header', 'scan', currentRow)} className="flex items-center gap-1 px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 text-xs rounded border border-amber-800">
                  <ScanText className="w-3.5 h-3.5" /> Scan Header
                </button>
              </div>
              <DebouncedWorkspaceTextarea className="w-full bg-amber-950/20 border border-amber-800/50 rounded-xl p-3 text-amber-100 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50 mb-4 shadow-inner" rows="3"
                value={currentRow['Question Header']} onChange={(val) => handleFieldUpdate('Question Header', val)} />
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Question</label>
                <button onClick={() => onTriggerScanner('Question text(Mandatory)', 'scan', currentRow)} className="flex items-center gap-1 px-2 py-1 bg-cyan-900/30 hover:bg-cyan-800 text-cyan-400 text-xs rounded border border-cyan-800">
                  <ScanText className="w-3.5 h-3.5" /> Scan Question
                </button>
              </div>
              <DebouncedWorkspaceTextarea className="w-full bg-black/20 border border-slate-700/60 rounded-xl p-4 text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 mb-4 shadow-inner" rows="4"
                value={currentRow['Question text(Mandatory)']} onChange={(val) => handleFieldUpdate('Question text(Mandatory)', val)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-3 block">Extracted Options</label>
              <div className="space-y-4">
                {[1, 2, 3, 4].map((num) => {
                  const isCorrect = currentRow[`Option${num} Is Correct?`] === 'Yes';
                  const optImage = currentRow[`If Option${num} is Image, Specify Image Name`];
                  return (
                    <div key={num} className="flex flex-col space-y-2 group">
                      <div className="flex items-center space-x-3 relative">
                        <button onClick={() => handleOptionToggle(num)}
                          className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center border transition-all duration-300 ${isCorrect ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.3)]' : 'bg-black/40 border-slate-700 text-slate-500'}`}>
                          {isCorrect ? '✓' : ''}
                        </button>
                        <div className="flex-1 relative flex items-center">
                          <span className="absolute left-3 text-slate-500 font-medium">{['A', 'B', 'C', 'D'][num - 1]}.</span>
                          <DebouncedWorkspaceInput type="text" value={currentRow[`Option${num} (Mandatory)`]}
                            onChange={(val) => handleFieldUpdate(`Option${num} (Mandatory)`, val)}
                            className={`w-full bg-black/20 border rounded-lg py-2.5 pl-9 pr-20 focus:outline-none transition-all ${isCorrect ? 'border-emerald-500/30 text-emerald-100 bg-emerald-900/10' : 'border-slate-800 text-slate-300 focus:border-blue-500/50'}`} />
                          <div className="absolute right-2 flex items-center gap-1">
                            <button onClick={() => onTriggerScanner(`If Option${num} is Image, Specify Image Name`, 'crop_qp', currentRow)} className="p-1 rounded text-slate-500 hover:text-cyan-400 hover:bg-cyan-900/30"><Crop className="w-4 h-4" /></button>
                            <button onClick={() => onTriggerScanner(`Option${num} (Mandatory)`, 'scan', currentRow)} className="p-1 rounded text-cyan-500 hover:text-cyan-300 hover:bg-cyan-900/30"><ScanText className="w-4 h-4" /></button>
                          </div>
                        </div>
                      </div>
                      {optImage && (
                        <div className="ml-10 flex items-center justify-between bg-[#0f172a] border border-cyan-900/30 px-3 py-1.5 rounded-md">
                          <div className="flex items-center space-x-2 text-xs text-slate-400 cursor-pointer hover:text-cyan-300" onClick={() => onImagePreview(optImage, currentRow)}>
                            <ImageIcon className="h-4 w-4 text-cyan-500" />
                            <span className="font-mono truncate max-w-[200px] font-medium">{optImage}</span>
                          </div>
                          <button onClick={() => handleFieldUpdate(`If Option${num} is Image, Specify Image Name`, '')} className="text-slate-600 hover:text-rose-400 text-lg leading-none">&times;</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="bg-black/30 border border-slate-800 rounded-xl p-5 shadow-inner">
                <div className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-4">Main Question Geometry Tools</div>
                <div className="flex space-x-3 mb-4">
                  <button onClick={() => onTriggerScanner('If Question is Image, Specify Image Name', 'crop_qp', currentRow)} className="flex-1 bg-slate-800/50 hover:bg-slate-700/80 text-slate-300 font-medium py-2.5 rounded-lg border border-slate-700/50 text-sm flex justify-center items-center gap-2"><Crop className="h-4 w-4" /> Map QP Crop</button>
                  <button onClick={() => onTriggerScanner('Answer_Diagram_Image', 'crop_ms', currentRow)} className="flex-1 bg-fuchsia-900/30 hover:bg-fuchsia-800/40 text-fuchsia-300 font-medium py-2.5 rounded-lg border border-fuchsia-700/50 text-sm flex justify-center items-center gap-2"><Crop className="h-4 w-4" /> Map MS Crop</button>
                </div>
                <div className="space-y-2">
                  {currentRow['If Question is Image, Specify Image Name'] && (
                    <div className="flex items-center justify-between bg-[#0f172a] border border-slate-700 px-4 py-3 rounded-lg">
                      <div className="flex items-center gap-3 cursor-pointer hover:opacity-80" onClick={() => onImagePreview(currentRow['If Question is Image, Specify Image Name'], currentRow)}>
                        <ImageIcon className="h-4 w-4 text-blue-400" />
                        <span className="truncate font-mono text-xs font-medium text-slate-400">{currentRow['If Question is Image, Specify Image Name']}</span>
                      </div>
                      <button onClick={() => handleFieldUpdate('If Question is Image, Specify Image Name', '')} className="text-slate-500 hover:text-rose-400">&times;</button>
                    </div>
                  )}
                  {currentRow['Answer_Diagram_Image'] && (
                    <div className="flex items-center justify-between bg-[#0f172a] border border-slate-700 px-4 py-3 rounded-lg">
                      <div className="flex items-center gap-3 cursor-pointer hover:opacity-80" onClick={() => onImagePreview(currentRow['Answer_Diagram_Image'], currentRow)}>
                        <ImageIcon className="h-4 w-4 text-fuchsia-400" />
                        <span className="truncate font-mono text-xs font-medium text-slate-400">{currentRow['Answer_Diagram_Image']}</span>
                      </div>
                      <button onClick={() => handleFieldUpdate('Answer_Diagram_Image', '')} className="text-slate-500 hover:text-rose-400">&times;</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const DebouncedWorkspaceInput = ({ value: initialValue, onChange, className, type = "text" }) => {
  const [val, setVal] = useState(initialValue || '');
  const isFocused = useRef(false);
  useEffect(() => { if (!isFocused.current) setVal(initialValue || ''); }, [initialValue]);
  return (
    <input type={type} value={val} onChange={(e) => setVal(e.target.value)}
      onFocus={() => { isFocused.current = true; }}
      onBlur={() => { isFocused.current = false; if (val !== (initialValue || '')) onChange(val); }}
      className={className} />
  );
};

const DebouncedWorkspaceTextarea = ({ value: initialValue, onChange, className, rows }) => {
  const [val, setVal] = useState(initialValue || '');
  const isFocused = useRef(false);
  useEffect(() => { if (!isFocused.current) setVal(initialValue || ''); }, [initialValue]);
  return (
    <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={rows}
      onFocus={() => { isFocused.current = true; }}
      onBlur={() => { isFocused.current = false; if (val !== (initialValue || '')) onChange(val); }}
      className={className} />
  );
};

// ==========================================
// GRID CELL COMPONENT
// ==========================================
const DebouncedCell = React.memo(({ value: initialValue, onChange, rowData, viewMode, column, isEdited, onTriggerCrop, onImageClick, jobId, onVerifyClick }) => {
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => { setValue(initialValue); }, [initialValue]);
  const onBlur = () => { setIsEditing(false); if (value !== initialValue) onChange(value); };

  const handleManualUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !jobId) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("q_sno", String(rowData['Sl.No'] || 'Unknown'));
      formData.append("set_name", String(rowData['SET Name'] || 'A'));
      formData.append("base_name", String(rowData['NIOS Filename'] || 'Document.pdf'));
      formData.append("field", column);
      formData.append("subject_code", String(rowData['Subject Code'] || ''));
      formData.append("source", column === 'Answer_Diagram_Image' ? 'MS' : 'QP');
      const res = await axios.post(`${API_BASE}/upload-manual-image/${jobId}`, formData);
      setValue(res.data.filename); onChange(res.data.filename);
    } catch (err) { alert("Injection failed."); }
    finally { setIsUploading(false); }
  };

  if (HIDDEN_ALWAYS.has(column)) return null;

  if (column === 'Is_Verified') {
    const isV = value === 'Yes';
    return (
      <div className="flex items-center justify-center h-full p-2">
        <button onClick={() => onChange(isV ? 'No' : 'Yes')}
          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isV ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400'}`}>
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (column === 'Extraction_Confidence') {
    const c = getConfidenceColor(value);
    return (
      <div style={{ background: c.bg, padding: '4px 8px', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <ConfidenceBadge score={value} />
      </div>
    );
  }

  let bgClass = "bg-transparent transition-all duration-300";
  const isImageColumn = column.includes("Image Name") || column === "Answer_Diagram_Image" || column.includes("Translate Image");
  const needsCrop = isImageColumn && rowData && rowData['MS_Diagram_Flag'] === 'Yes' && (!value || value === "");
  if (isImageColumn && needsCrop) bgClass = "bg-rose-50 border border-rose-200 shadow-[inset_0_0_10px_rgba(244,63,94,0.1)]";

  const auditBadge = isEdited ? (
    <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white rounded-full p-0.5 shadow-sm z-10"><Check className="w-2.5 h-2.5" /></div>
  ) : null;

  if (isImageColumn) {
    return (
      <div className={`p-2 w-full h-full flex flex-col items-center justify-center min-h-[44px] max-h-[80px] relative group border border-dashed border-transparent hover:border-slate-300 rounded ${bgClass}`}>
        {auditBadge}
        {needsCrop && <div className="absolute top-1 right-1 p-1 z-10"><AlertTriangle className="w-4 h-4 text-rose-500 animate-pulse" /></div>}
        {isUploading ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> : value ? (
          <div className="flex flex-col items-center w-full gap-1">
            <div className="flex items-center justify-between bg-white border border-emerald-300 shadow-sm rounded px-2 py-1.5 w-full cursor-pointer hover:bg-emerald-50" onClick={(e) => { e.stopPropagation(); onImageClick(value, rowData); }}>
              <span className="text-[10px] text-emerald-700 font-bold truncate max-w-[80px]">✓ {value}</span>
              <button onClick={(e) => { e.stopPropagation(); setValue(""); onChange(""); }} className="text-slate-300 hover:text-red-500 p-1"><Trash2 className="w-3 h-3" /></button>
            </div>
            {!viewMode && <label className="text-[9px] text-blue-500 cursor-pointer hover:underline opacity-0 group-hover:opacity-100">Replace File<input type="file" accept="image/*" className="hidden" onChange={handleManualUpload} /></label>}
          </div>
        ) : (
          !viewMode && (
            <div className="flex flex-col gap-1.5 items-center opacity-0 group-hover:opacity-100">
              <button onClick={(e) => { e.stopPropagation(); onTriggerCrop(); }} className="text-[10px] bg-white border border-slate-300 rounded px-2 py-1 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-1 w-full justify-center shadow-sm text-slate-600"><Crop className="w-3 h-3" /> Map Geometry</button>
              <label className="text-[10px] bg-white border border-slate-300 rounded px-2 py-1 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-1 cursor-pointer w-full justify-center shadow-sm text-slate-600"><UploadCloud className="w-3 h-3" /> Inject<input type="file" accept="image/*" className="hidden" onChange={handleManualUpload} /></label>
            </div>
          )
        )}
      </div>
    );
  }

  if (viewMode || !isEditing) return (
    // FIX 4: added max-w-[420px] overflow-hidden to prevent question text column from stretching
    <div className={`p-2 w-full h-full min-h-[40px] cursor-text break-words whitespace-pre-wrap relative group text-slate-700 max-w-[420px] overflow-hidden ${bgClass}`}
      onClick={() => !viewMode && setIsEditing(true)}>
      {auditBadge}
      {formatTextWithMath(value ? String(value) : "")}
      {!viewMode && column.includes('text') && (
        <button onClick={(e) => { e.stopPropagation(); onVerifyClick(rowData); }}
          className="absolute bottom-1 right-1 p-1.5 bg-blue-600 text-white rounded-lg opacity-0 group-hover:opacity-100 shadow-lg hover:bg-blue-700" title="Open Workspace">
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return <textarea className="p-2 w-full h-full min-h-[80px] min-w-[200px] border-2 border-blue-400 focus:ring-4 focus:ring-blue-400/20 focus:outline-none rounded resize-y bg-white text-slate-900 relative z-50 shadow-xl" value={value} onChange={(e) => setValue(e.target.value)} onBlur={onBlur} autoFocus />;
}, (prevProps, nextProps) => {
  return prevProps.value === nextProps.value &&
    prevProps.isEdited === nextProps.isEdited &&
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.jobId === nextProps.jobId;
});

const MemoizedDataRow = React.memo(({ row, rowIndex, visibleColumns, viewMode, activeTab, jobId, editedCells, insertRow, deleteRow, handleDataChange, setCropModalConfig, setImagePreviewConfig, openReviewAtId, highlightedRowId }) => {
  const rowRef = useRef(null);
  const isVerified = row['Is_Verified'] === 'Yes';
  const conf = parseInt(row['Extraction_Confidence'] || 75);
  const isHighlighted = highlightedRowId === row.id;
  const numOpts = parseInt(row['No. of Options/Blanks (Mandatory)'] || '0', 10);
  const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?'].some(c => row[c] === 'Yes');
  const isDuplicateTarget = (numOpts > 0 && !hasCorrect) || row['Duplicate_Flag'] === 'Yes';

  useEffect(() => {
    if (isHighlighted && rowRef.current) rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [isHighlighted]);

  let rowBg = 'hover:bg-blue-50/50';
  if (isDuplicateTarget) rowBg = 'bg-amber-50/80 hover:bg-amber-100/80 border-l-4 border-amber-400';
  else if (isVerified) rowBg = 'bg-emerald-50/40 hover:bg-emerald-50/60';
  else if (conf < 60) rowBg = 'bg-orange-50/40 hover:bg-orange-50';

  return (
    <tr ref={rowRef} className={`group transition-colors duration-200 ${rowBg} ${isHighlighted ? 'ring-2 ring-inset ring-blue-400' : ''}`}>
      <td className="sticky left-0 bg-white group-hover:bg-blue-50/50 z-20 px-1 py-2 border-b border-r border-slate-200 w-16 align-middle">
        <div className="flex flex-col items-center gap-1 opacity-20 group-hover:opacity-100">
          <button onClick={() => insertRow(row.id, 'above')} className="p-0.5 hover:bg-blue-100 rounded text-blue-500"><Plus className="w-3 h-3" /></button>
          <button onClick={() => deleteRow(row.id)} className="p-1 hover:bg-red-100 rounded text-red-500"><Trash2 className="w-3 h-3" /></button>
          <button onClick={() => insertRow(row.id, 'below')} className="p-0.5 hover:bg-blue-100 rounded text-blue-500"><Plus className="w-3 h-3" /></button>
        </div>
      </td>
      {visibleColumns.map((col) => {
        const isSlNo = col === 'Sl.No';
        return (
          <td key={col} className={`p-0 border-b border-r border-slate-200 align-middle ${isSlNo ? 'sticky left-[64px] min-w-[60px] text-center bg-white group-hover:bg-blue-50/50 z-10' : ''}`}>
            <DebouncedCell value={row[col] || ""} rowData={row} viewMode={viewMode} column={col}
              isEdited={editedCells[`${activeTab}-${row.id}-${col}`]} jobId={jobId}
              onChange={(val) => handleDataChange(row.id, col, val)}
              onTriggerCrop={() => setCropModalConfig({ isOpen: true, rowData: row, column: col })}
              onImageClick={(imgVal, rowData) => setImagePreviewConfig({ isOpen: true, imageUrl: imgVal, baseName: rowData['NIOS Filename'] })}
              onVerifyClick={(r) => openReviewAtId(r.id)} />
          </td>
        );
      })}
    </tr>
  );
}, (prevProps, nextProps) => {
  if (prevProps.row !== nextProps.row) return false;
  if (prevProps.viewMode !== nextProps.viewMode) return false;
  if (prevProps.jobId !== nextProps.jobId) return false;
  if (prevProps.highlightedRowId !== nextProps.highlightedRowId) return false;
  const prefix = `${prevProps.activeTab}-${prevProps.row?.id}-`;
  const pc = Object.keys(prevProps.editedCells).filter(k => k.startsWith(prefix)).length;
  const nc = Object.keys(nextProps.editedCells).filter(k => k.startsWith(prefix)).length;
  return pc === nc;
});

const EXPORT_Q_KEY = 'dp_export_queue';
const getExportQueue = () => { try { return JSON.parse(localStorage.getItem(EXPORT_Q_KEY) || '[]'); } catch { return []; } };
const addToExportQueue = (item) => { const q = getExportQueue(); q.push(item); localStorage.setItem(EXPORT_Q_KEY, JSON.stringify(q)); };
const clearExportQueue = () => localStorage.removeItem(EXPORT_Q_KEY);

// ==========================================
// MAIN PARSER COMPONENT
// ==========================================
export default function Parser() {
  const [engineFiles, setEngineFiles] = useState([]);
  const [toast, setToast] = useState(null);
  const showToast = (message) => { setToast(message); setTimeout(() => setToast(null), 5000); };
  const [currentQueueIdx, setCurrentQueueIdx] = useState(0);
  const [autoTimer, setAutoTimer] = useState(null);
  const [selectedTargetSet, setSelectedTargetSet] = useState("ALL");
  const navigate = useNavigate();

  const handleQueueDrop = (e) => {
    if (e.target.files && e.target.files.length > 0) setEngineFiles(prev => [...prev, ...Array.from(e.target.files)]);
    e.target.value = null;
  };

  const queuedPairs = useMemo(() => {
    const isMarkingSchemeFile = (filename) => {
      const stem = filename.replace(/\.pdf$/i, '').toLowerCase();
      const normalized = stem.replace(/[^a-z0-9]+/g, ' ').trim();
      const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
      return stem.startsWith('ms_') || stem.startsWith('ms-') || stem.startsWith('ms ')
        || normalized.includes('marking scheme')
        || normalized.includes('answer key')
        || normalized.includes('answerkey')
        || tokens.has('ms')
        || tokens.has('solution')
        || tokens.has('solutions')
        || tokens.has('tm');
    };
    const grouped = {};
    engineFiles.forEach(f => {
      const name = f.name.toLowerCase();
      if (!name.endsWith('.pdf')) return;
      const isMS = isMarkingSchemeFile(f.name);
      const isQP = !isMS;
      const baseName = f.name
        .replace(/^(qp|ms)[_\-\s]*/i, '')
        .replace(/_[a-zA-Z0-9]{15,}\.pdf$/i, '')
        .replace(/\.pdf$/i, '');
      if (!grouped[baseName]) grouped[baseName] = { qps: [], mss: [] };
      if (isQP) grouped[baseName].qps.push(f);
      if (isMS) grouped[baseName].mss.push(f);
    });

    const allQps = Object.values(grouped).flatMap(group => group.qps);
    const allMs = Object.values(grouped).flatMap(group => group.mss);
    const exactPairs = Object.entries(grouped).flatMap(([baseName, group]) =>
      group.qps.map(qp => ({ baseName, qp, ms: group.mss.shift() || null }))
    );
    if (allQps.length === 2 && allMs.length === 0) {
      return [{
        baseName: allQps[0].name.replace(/^(qp|ms)[_\-\s]*/i, '').replace(/_[a-zA-Z0-9]{15,}\.pdf$/i, '').replace(/\.pdf$/i, ''),
        qp: allQps[0],
        ms: allQps[1]
      }];
    }
    if (allQps.length > 0 && allQps.length === allMs.length && exactPairs.some(pair => !pair.ms)) {
      return allQps.map((qp, idx) => ({
        baseName: qp.name.replace(/^(qp|ms)[_\-\s]*/i, '').replace(/_[a-zA-Z0-9]{15,}\.pdf$/i, '').replace(/\.pdf$/i, ''),
        qp,
        ms: allMs[idx] || null
      }));
    }
    const sharedMs = allMs.length === 1 ? allMs[0] : null;
    return exactPairs.map(pair => ({ ...pair, ms: pair.ms || sharedMs || null }));
  }, [engineFiles]);

  const [engineStatus, setEngineStatus] = useState("idle");
  const [engineJobId, setEngineJobId] = useState(null);
  const [engineLogs, setEngineLogs] = useState(INITIAL_INSTRUCTIONS);
  const [engineProgress, setEngineProgress] = useState(0);
  const [engineStats, setEngineStats] = useState({ parsed: 0, diagrams: 0, duplicates: 0, trash: 0 });
  const [enginePageMap, setEnginePageMap] = useState({ total: 0, pages: {} });
  const [jobHeartbeat, setJobHeartbeat] = useState({ status: 'idle', rows: 0, message: 'Waiting' });
  const [crossValidation, setCrossValidation] = useState(null);

  const [activeTab, setActiveTab] = useState("engine");
  const [openTabs, setOpenTabs] = useState([]);
  const [editingTabId, setEditingTabId] = useState(null);
  const [editingTabName, setEditingTabName] = useState("");

  const saveTabName = (id) => {
    if (editingTabName.trim() !== "") setOpenTabs(prev => prev.map(t => t.id === id ? { ...t, label: editingTabName.trim() } : t));
    setEditingTabId(null);
  };

  const [columnMode, setColumnMode] = useState('list');
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);
  const [matrices, setMatrices] = useState({});
  const [editedCells, setEditedCells] = useState({});
  const [customColumns, setCustomColumns] = useState([]);
  const [history, setHistory] = useState({});
  const [viewMode, setViewMode] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFiles, setImportFiles] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("Initializing...");
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const [reviewModalConfig, setReviewModalConfig] = useState({ isOpen: false, rowId: null });
  const [cropModalConfig, setCropModalConfig] = useState({ isOpen: false, rowData: null, column: null });
  const [scanModalConfig, setScanModalConfig] = useState({ isOpen: false, rowData: null, column: null });
  const [imagePreviewConfig, setImagePreviewConfig] = useState({ isOpen: false, imageUrl: null, baseName: null });
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [highlightedRowId, setHighlightedRowId] = useState(null);

  const logsEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const logConnectTimerRef = useRef(null);
  const lastPolledRowsRef = useRef(0);
  const backendCompleteLogRef = useRef('');
  const latestDataRef = useRef(matrices);
  const isDirtyRef = useRef(false);
  // FIX: tracks rows explicitly deleted by the user â€” fetchFinalData will never re-add them
  const deletedRowIdsRef = useRef(new Set());
  const deletedRowFingerprintsRef = useRef(new Set());

  // FIX 1a: refs that always hold latest state â€” used in fetchFinalData to avoid stale closures
  const latestMatricesRef = useRef(matrices);
  const latestOpenTabsRef = useRef(openTabs);
  const latestHistoryRef = useRef(history);
  const lastBlankFetchRef = useRef('');

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const res = await axios.get(`${API_BASE}/redis/load`);
        if (res.data && res.data.success && res.data.workspace) {
          const { dp_matrices, dp_openTabs, dp_activeTab, dp_editedCells, dp_engineJobId, dp_customCols } = res.data.workspace;
          const restoredMatrices = dp_matrices && typeof dp_matrices === 'object' ? dp_matrices : {};
          const restoredOpenTabs = Array.isArray(dp_openTabs) ? dp_openTabs : [];
          if (Object.keys(restoredMatrices).length > 0) setMatrices(restoredMatrices);
          if (restoredOpenTabs.length > 0) setOpenTabs(restoredOpenTabs);
          const bestTab =
            (dp_activeTab && Array.isArray(restoredMatrices[dp_activeTab]) && restoredMatrices[dp_activeTab].length > 0 && dp_activeTab) ||
            restoredOpenTabs.find(t => Array.isArray(restoredMatrices[t.id]) && restoredMatrices[t.id].length > 0)?.id ||
            (dp_activeTab && restoredOpenTabs.some(t => t.id === dp_activeTab) && dp_activeTab) ||
            restoredOpenTabs[0]?.id ||
            'engine';
          setActiveTab(bestTab);
          if (dp_editedCells) setEditedCells(dp_editedCells);
          if (dp_engineJobId) setEngineJobId(dp_engineJobId);
          if (dp_customCols) setCustomColumns(dp_customCols);
        }
      } catch (error) {
        console.warn("Could not load from Redis, starting fresh.");
      } finally {
        setWorkspaceLoaded(true);
      }
    };
    loadWorkspace();
  }, []);

  const flaggedIds = useMemo(() => {
    const data = matrices[activeTab] || [];
    return data.filter(row => {
      const conf = parseInt(row['Extraction_Confidence'] || '75');
      const numOpts = parseInt(row['No. of Options/Blanks (Mandatory)'] || '0', 10);
      const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?'].some(c => row[c] === 'Yes');
      const missingText = !(row['Question text(Mandatory)'] || '').trim();
      const missingAnswer = numOpts > 0 && !hasCorrect;
      return conf < 60 || missingAnswer || missingText;
    }).map(r => r.id);
  }, [matrices, activeTab]);

  const tabProgress = useMemo(() => {
    const result = {};
    openTabs.forEach(tab => {
      const data = matrices[tab.id] || [];
      result[tab.id] = { verified: data.filter(r => r['Is_Verified'] === 'Yes').length, total: data.length };
    });
    return result;
  }, [openTabs, matrices]);

  const visibleColumns = useMemo(() => {
    if (columnMode === 'verify') return VERIFY_MODE_COLUMNS;
    const base = DEFAULT_COLUMNS.filter(c => !HIDDEN_ALWAYS.has(c));
    return customColumns.length ? [...base, ...customColumns] : base;
  }, [columnMode, customColumns]);

  const rawActiveData = matrices[activeTab] || [];
  const activeData = showUnverifiedOnly ? rawActiveData.filter(r => r['Is_Verified'] !== 'Yes') : rawActiveData;

  useEffect(() => {
    if (autoTimer === null || autoTimer <= 0) return;
    const interval = setInterval(() => setAutoTimer(t => t - 1), 1000);
    return () => clearInterval(interval);
  }, [autoTimer]);

  useEffect(() => {
    if (autoTimer === 0) { setAutoTimer(null); handleNextFilePair(); }
  }, [autoTimer]);

  const handleNextFilePair = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    const nextIdx = currentQueueIdx + 1;
    if (nextIdx < queuedPairs.length) {
      setCurrentQueueIdx(nextIdx); setEngineStatus("idle"); setEngineJobId(null);
      const startSet = selectedTargetSet === "ALL" ? "A" : selectedTargetSet;
      setTimeout(() => startEngine(startSet, nextIdx), 500);
    } else {
      setEngineLogs(prev => [...prev, { type: 'success', text: 'MASTER QUEUE COMPLETE! All files processed.' }]);
      setEngineStatus("idle");
    }
  };

  useEffect(() => {
    const refreshGatewayStatus = () => {
      axios.get(`${API_BASE}/gateway-health`).then(res => {
        setApiKeyStatus(`${res.data.active_sessions || 0} users / ${res.data.ports?.length || 0} ports`);
      }).catch(() => setApiKeyStatus("Offline"));
    };
    refreshGatewayStatus();
    const timer = setInterval(refreshGatewayStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!workspaceLoaded) return;
    if (engineJobId && Object.keys(matrices).length === 0) {
      fetchFinalData(engineJobId, currentQueueIdx, { markCompleted: false, switchToTab: true });
    }
  }, [workspaceLoaded, engineJobId, matrices, currentQueueIdx]);

  useEffect(() => {
    if (!workspaceLoaded || activeTab === 'engine') return;
    if ((matrices[activeTab] || []).length > 0) return;
    const activeTabInfo = openTabs.find(t => t.id === activeTab);
    if (!activeTabInfo?.jobId) return;
    const fetchKey = `${activeTabInfo.jobId}:${activeTabInfo.setName || ''}:${activeTab}`;
    if (lastBlankFetchRef.current === fetchKey) return;
    lastBlankFetchRef.current = fetchKey;
    fetchFinalData(activeTabInfo.jobId, currentQueueIdx, { markCompleted: false, switchToTab: false });
  }, [workspaceLoaded, activeTab, openTabs, matrices, currentQueueIdx]);

  // FIX 1b: keep refs in sync â€” fetchFinalData reads from these refs, not stale closure
  useEffect(() => {
    latestDataRef.current = matrices;
    latestMatricesRef.current = matrices;
    latestOpenTabsRef.current = openTabs;
    latestHistoryRef.current = history;

    const saveTimer = setTimeout(async () => {
      try {
        const workspaceData = {
          dp_activeTab: activeTab,
          dp_openTabs: openTabs,
          dp_editedCells: editedCells,
          dp_engineJobId: engineJobId,
          dp_customCols: customColumns,
          dp_matrices: matrices
        };
        await axios.post(`${API_BASE}/redis/save`, { workspace: workspaceData });
      } catch (e) {
        console.error("Failed to sync workspace to Redis", e);
      }
    }, 2000);

    return () => clearTimeout(saveTimer);
  }, [activeTab, openTabs, matrices, editedCells, engineJobId, customColumns, history]);

  useEffect(() => {
    if (activeTab === 'engine') return;
    const activeTabInfo = openTabs.find(t => t.id === activeTab);
    const targetJobId = activeTabInfo ? activeTabInfo.jobId : null;
    if (!targetJobId) return;
    const interval = setInterval(() => {
      if (!isDirtyRef.current) return;
      const dataToSave = latestDataRef.current[activeTab];
      if (Array.isArray(dataToSave)) {
        axios.post(`${API_BASE}/sync-db/${targetJobId}`, { parsed_data: dataToSave }).then(() => { isDirtyRef.current = false; }).catch(() => { });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, openTabs]);

  useEffect(() => {
    const iv = setInterval(async () => {
      const q = getExportQueue();
      if (!q.length) return;
      try {
        await axios.post(`${API_BASE}/export-zip/${q[0].jobId}`, { set_name: q[0].set_name, data: q[0].data }, { responseType: 'blob' });
        clearExportQueue(); showToast('âœ… Queued export succeeded!');
      } catch { }
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [engineLogs]);
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (logConnectTimerRef.current) window.clearTimeout(logConnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (engineStatus !== 'processing' || !engineJobId) return;
    let cancelled = false;
    const pollJobData = async () => {
      try {
        const response = await axios.get(`${API_BASE}/data/${engineJobId}`);
        if (cancelled) return;
        const rows = response.data?.parsed_data?.length || 0;
        const status = response.data?.status || '';
        const readableStatus = status || (rows > 0 ? 'processing' : 'queued');
        setJobHeartbeat({
          status: readableStatus,
          rows,
          message: ['waiting_for_next_set', 'completed'].includes(status)
            ? 'Backend completed. Loading rows into workspace...'
            : status === 'cancelled'
              ? 'Backend cancelled.'
              : status === 'halted'
                ? 'Backend halted.'
                : 'Backend is processing pages.'
        });
        if (rows > lastPolledRowsRef.current) lastPolledRowsRef.current = rows;
        if (['waiting_for_next_set', 'completed', 'cancelled', 'halted'].includes(status)) {
          if (eventSourceRef.current) eventSourceRef.current.close();
          setEngineProgress(100);
          const completeKey = `${engineJobId}:${status}:${rows}`;
          if (backendCompleteLogRef.current !== completeKey) {
            backendCompleteLogRef.current = completeKey;
            setEngineLogs(prev => [...prev, {
              type: status === 'cancelled' || status === 'halted' ? 'warning' : 'success',
              text: `Backend status: ${status || 'completed'} - ${rows} row(s) available.`
            }]);
          }
          const shouldMarkCompleted = ['waiting_for_next_set', 'completed'].includes(status);
          setEngineStatus(status === 'waiting_for_next_set' ? 'completed' : 'idle');
          await fetchFinalData(engineJobId, currentQueueIdx, { markCompleted: shouldMarkCompleted, switchToTab: true });
        }
      } catch { }
    };
    pollJobData();
    const timer = window.setInterval(pollJobData, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [engineStatus, engineJobId, currentQueueIdx]);

  // â”€â”€ SAFETY NET 1: Block backspace browser-back during extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const block = (e) => {
      if (e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      const editable = document.activeElement?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
      if (engineStatus === 'processing') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [engineStatus]);

  // â”€â”€ SAFETY NET 2: Warn before tab close / refresh during extraction â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const warn = (e) => {
      if (engineStatus !== 'processing') return;
      e.preventDefault();
      e.returnValue = 'Extraction is in progress â€” leaving will cancel it.';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [engineStatus]);

  const resetEngine = () => {
    setEngineFiles([]); setCurrentQueueIdx(0); setAutoTimer(null);
    setEngineStatus("idle"); setEngineLogs(INITIAL_INSTRUCTIONS); setEngineProgress(0);
    setJobHeartbeat({ status: 'idle', rows: 0, message: 'Waiting' });
    setEnginePageMap({ total: 0, pages: {} }); setEngineJobId(null); setCrossValidation(null);
    if (eventSourceRef.current) eventSourceRef.current.close();
    if (logConnectTimerRef.current) window.clearTimeout(logConnectTimerRef.current);
  };

  const closeTab = (tabToClose) => {
    const newTabs = openTabs.filter(t => t.id !== tabToClose);
    setOpenTabs(newTabs);
    if (activeTab === tabToClose && newTabs.length > 0) setActiveTab(newTabs[0].id);
    else if (activeTab === tabToClose) setActiveTab('engine');
  };

  const handleFindReplace = (findText, replaceText, targetColumn, useRegex) => {
    const data = matrices[activeTab]; if (!data) return;
    const newData = data.map(row => {
      const val = String(row[targetColumn] || '');
      let nv;
      if (useRegex) { try { nv = val.replace(new RegExp(findText, 'gi'), replaceText); } catch { nv = val; } }
      else nv = val.split(findText).join(replaceText);
      return nv !== val ? { ...row, [targetColumn]: nv } : row;
    });
    pushToHistory(activeTab, newData); isDirtyRef.current = true;
    showToast(`âœ… Find & Replace applied to "${targetColumn}"`);
  };

  const deleteUnansweredDuplicates = () => {
    const data = matrices[activeTab]; if (!data) return;
    const newData = data.filter(row => {
      const numOpts = parseInt(row['No. of Options/Blanks (Mandatory)'] || '0', 10);
      const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?'].some(c => row[c] === 'Yes');
      return !((numOpts > 0 && !hasCorrect) || row['Duplicate_Flag'] === 'Yes');
    });
    const removedCount = data.length - newData.length;
    if (removedCount > 0) { pushToHistory(activeTab, newData); isDirtyRef.current = true; showToast(`âœ… Removed ${removedCount} duplicate/unanswered questions.`); }
    else showToast("No yellow-flagged duplicates found.");
  };

  const bulkMarkOption1 = () => {
    const data = matrices[activeTab]; if (!data) return;
    let count = 0;
    const newData = data.map(row => {
      const hasCorrect = ['Option1 Is Correct?', 'Option2 Is Correct?', 'Option3 Is Correct?', 'Option4 Is Correct?'].some(c => row[c] === 'Yes');
      if (!hasCorrect) {
        count++;
        return {
          ...row,
          'Option1 Is Correct?': 'Yes',
          'Option2 Is Correct?': 'No',
          'Option3 Is Correct?': 'No',
          'Option4 Is Correct?': 'No',
        };
      }
      return row;
    });
    pushToHistory(activeTab, newData); isDirtyRef.current = true;
    setMatrices(prev => { const u = { ...prev, [activeTab]: newData }; latestDataRef.current = u; latestMatricesRef.current = u; return u; });
    showToast(`âœ… Bulk Mark: Set Option A as correct for ${count} question(s).`);
  };

  const executeWorkspaceRestore = async () => {
    const excelFile = importFiles.find(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
    const pdfAndZipFiles = importFiles.filter(f => f.name.endsWith('.pdf') || f.name.endsWith('.zip'));
    setIsImporting(true);
    const newJobId = uuidv4();
    if (pdfAndZipFiles.length > 0) {
      const formData = new FormData();
      pdfAndZipFiles.forEach(f => formData.append("files", f));
      try { await axios.post(`${API_BASE}/restore-workspace/${newJobId}`, formData); } catch { }
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const newMatrices = { ...latestMatricesRef.current }, newOpenTabs = [...latestOpenTabsRef.current], newHistory = { ...latestHistoryRef.current };
        let lastImportedTabId = "engine";
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
          if (rawData.length === 0) return;
          let setName = String(rawData[0]['SET Name'] || sheetName.split('_').pop() || "A").toUpperCase();
          let uniqueTabId = `import-${newJobId}-${setName}`;
          let subjectName = rawData[0]['Subject Name'] || 'Imported';
          const sanitizedData = rawData.map(row => {
            const cleanRow = {};
            Object.keys(row).forEach(k => {
              let val = row[k];
              cleanRow[k] = (val === null || val === undefined || String(val).toLowerCase() === 'null' || String(val).toLowerCase() === 'none') ? "" : val;
            });
            let pUrl = cleanRow['Page_Image_URL'] ? String(cleanRow['Page_Image_URL']).replace(/\/workspace\/[^\/]+\//, `/workspace/${newJobId}/`) : "";
            let msUrl = cleanRow['MS_Page_Image_URL'] ? String(cleanRow['MS_Page_Image_URL']).replace(/\/workspace\/[^\/]+\//, `/workspace/${newJobId}/`) : "";
            return { ...cleanRow, 'id': cleanRow.id || uuidv4(), 'SET Name': setName, 'Is_Verified': cleanRow['Is_Verified'] || 'No', 'Duplicate_Flag': String(cleanRow['Duplicate_Flag'] || 'No'), 'MS_Diagram_Flag': String(cleanRow['MS_Diagram_Flag'] || 'No'), 'Page_Image_URL': pUrl, 'MS_Page_Image_URL': msUrl };
          });
          newMatrices[uniqueTabId] = sanitizedData;
          newOpenTabs.push({ id: uniqueTabId, label: `${subjectName} (Set ${setName})`, jobId: newJobId, setName, qpName: sanitizedData[0]['NIOS Filename'] || 'Unknown' });
          newHistory[uniqueTabId] = { past: [], future: [] };
          lastImportedTabId = uniqueTabId;
        });
        setMatrices(newMatrices); setOpenTabs(newOpenTabs); setHistory(newHistory);
        setShowImportModal(false); setImportFiles([]); setIsImporting(false);
        setActiveTab(lastImportedTabId); setEngineJobId(newJobId);
      } catch { setIsImporting(false); }
    };
    if (excelFile) reader.readAsArrayBuffer(excelFile);
    else setIsImporting(false);
  };

  const pushToHistory = (tabId, newData) => {
    setHistory(prev => {
      const setHist = prev[tabId] || { past: [], future: [] };
      return { ...prev, [tabId]: { past: [...setHist.past, matrices[tabId]].slice(-10), future: [] } };
    });
    setMatrices(prev => ({ ...prev, [tabId]: newData }));
  };

  const undo = () => {
    if (activeTab === 'engine' || !history[activeTab] || history[activeTab].past.length === 0) return;
    setHistory(prev => {
      const setHist = prev[activeTab];
      const previousState = setHist.past[setHist.past.length - 1];
      setMatrices(m => ({ ...m, [activeTab]: previousState }));
      return { ...prev, [activeTab]: { past: setHist.past.slice(0, -1), future: [matrices[activeTab], ...setHist.future] } };
    });
  };

  const redo = () => {
    if (activeTab === 'engine' || !history[activeTab] || history[activeTab].future.length === 0) return;
    setHistory(prev => {
      const setHist = prev[activeTab];
      const nextState = setHist.future[0];
      setMatrices(m => ({ ...m, [activeTab]: nextState }));
      return { ...prev, [activeTab]: { past: [...setHist.past, matrices[activeTab]], future: setHist.future.slice(1) } };
    });
  };

  const insertRow = (rowId, direction) => {
    const newData = [...(matrices[activeTab] || [])];
    const index = newData.findIndex(r => r.id === rowId);
    if (index === -1) return null;
    const refRow = newData[index];
    const newRowId = uuidv4();
    const newRow = {
      id: newRowId, 'SET Name': refRow?.['SET Name'] || 'A',
      'NIOS Filename': refRow?.['NIOS Filename'],
      'Page_Image_URL': refRow?.['Page_Image_URL'],
      'MS_Page_Image_URL': refRow?.['MS_Page_Image_URL'],
      'Is_Verified': 'No'
    };
    [...DEFAULT_COLUMNS, ...customColumns].forEach(col => { if (newRow[col] === undefined) newRow[col] = ""; });
    newData.splice(direction === 'above' ? index : index + 1, 0, newRow);
    pushToHistory(activeTab, newData);
    isDirtyRef.current = true;
    return newRowId;
  };

  const deleteRow = useCallback(async (rowId) => {
    const currentData = latestDataRef.current[activeTab] || [];
    const rowToDelete = currentData.find(r => r.id === rowId);
    if (!rowToDelete) return;
    const newData = currentData.filter(r => r.id !== rowId);

    // Track the deleted ID BEFORE any state update so fetchFinalData can never re-add it
    deletedRowIdsRef.current.add(rowId);
    deletedRowFingerprintsRef.current.add(rowFingerprint(rowToDelete));

    setMatrices(prev => {
      const updated = { ...prev, [activeTab]: newData };
      latestDataRef.current = updated;
      latestMatricesRef.current = updated; // FIX BUG A: keep ref in sync immediately
      return updated;
    });
    setHistory(prev => { const setHist = prev[activeTab] || { past: [], future: [] }; return { ...prev, [activeTab]: { past: [...setHist.past, currentData].slice(-10), future: [] } }; });
    isDirtyRef.current = true;
    const activeTabInfo = openTabs.find(t => t.id === activeTab);
    if (activeTabInfo && rowToDelete.id) {
      try { await axios.delete(`${API_BASE}/delete-row/${activeTabInfo.jobId}/${rowToDelete.id}`); } catch { }
      try {
        await axios.post(`${API_BASE}/sync-db/${activeTabInfo.jobId}`, { parsed_data: newData });
        isDirtyRef.current = false;
      } catch {
        isDirtyRef.current = true;
      }
    }
  }, [activeTab, openTabs]);

  const handleAddColumn = () => {
    const colName = prompt("Enter new column name:");
    if (colName && !DEFAULT_COLUMNS.includes(colName) && !customColumns.includes(colName)) {
      setCustomColumns(prev => [...prev, colName]);
    }
  };

  const handleDataChangeMulti = useCallback((rowId, updates) => {
    setMatrices(prev => {
      const newData = [...(prev[activeTab] || [])];
      const rIndex = newData.findIndex(r => r.id === rowId);
      if (rIndex !== -1) {
        newData[rIndex] = { ...newData[rIndex], ...updates };
        setHistory(hPrev => { const setHist = hPrev[activeTab] || { past: [], future: [] }; return { ...hPrev, [activeTab]: { past: [...setHist.past, prev[activeTab]].slice(-10), future: [] } }; });
        Object.keys(updates).forEach(col => setEditedCells(ePrev => ({ ...ePrev, [`${activeTab}-${rowId}-${col}`]: true })));
        isDirtyRef.current = true;
        return { ...prev, [activeTab]: newData };
      }
      return prev;
    });
  }, [activeTab]);

  const handleDataChange = useCallback((rowId, column, value) => {
    setMatrices(prev => {
      const newData = [...(prev[activeTab] || [])];
      const rowIndex = newData.findIndex(r => r.id === rowId);
      if (rowIndex === -1) return prev;
      newData[rowIndex] = { ...newData[rowIndex], [column]: value };
      setHistory(hPrev => { const setHist = hPrev[activeTab] || { past: [], future: [] }; return { ...hPrev, [activeTab]: { past: [...setHist.past, prev[activeTab]].slice(-10), future: [] } }; });
      setEditedCells(ePrev => ({ ...ePrev, [`${activeTab}-${rowId}-${column}`]: true }));
      isDirtyRef.current = true;
      return { ...prev, [activeTab]: newData };
    });
  }, [activeTab]);

  const startEngine = async (targetSet = "A", queueIdx = currentQueueIdx) => {
    if (queuedPairs.length === 0) return;
    lastPolledRowsRef.current = 0;
    backendCompleteLogRef.current = '';
    setAutoTimer(null);
    setJobHeartbeat({ status: 'starting', rows: 0, message: 'Starting backend job...' });
    setEngineStatus("processing"); setEngineProgress(0); setActiveTab("engine"); setCrossValidation(null);
    setEngineLogs([
      { type: 'info', text: `Starting extraction for document ${queueIdx + 1}/${queuedPairs.length}.` },
      { type: 'info', text: 'Connecting to live log stream...' }
    ]);
    try {
      let activeJobId = engineJobId;
      if (engineStatus !== "completed" || targetSet === "A") {
        const formData = new FormData();
        formData.append("files", queuedPairs[queueIdx].qp);
        if (queuedPairs[queueIdx].ms) formData.append("files", queuedPairs[queueIdx].ms);
        formData.append("target_set", selectedTargetSet);
        const res = await axios.post(`${API_BASE}/process-documents`, formData);
        activeJobId = res.data.job_id;
        setEngineJobId(activeJobId);
      } else {
        await axios.post(`${API_BASE}/continue-set/${activeJobId}?next_set=${targetSet}`);
      }
      if (logConnectTimerRef.current) window.clearTimeout(logConnectTimerRef.current);
      logConnectTimerRef.current = window.setTimeout(() => {
        setEngineLogs(prev => {
          if (prev.some(item => item.text === 'Live log stream is slow to connect. Backend status polling is still active.')) return prev;
          return [...prev, {
            type: 'warning',
            text: 'Live log stream is slow to connect. Backend status polling is still active.'
          }];
        });
        setJobHeartbeat(prev => ({
          ...prev,
          message: 'Log stream is delayed. Still checking backend data every 2 seconds.'
        }));
      }, 45000);

      eventSourceRef.current = new EventSource(`${API_BASE}/logs/${activeJobId}?workspace_id=${encodeURIComponent(getAdsWorkspaceId())}`);
      eventSourceRef.current.onopen = () => {
        if (logConnectTimerRef.current) window.clearTimeout(logConnectTimerRef.current);
        logConnectTimerRef.current = null;
      };
      eventSourceRef.current.onerror = () => {
        setEngineLogs(prev => {
          if (prev.some(item => item.text === 'Live log stream disconnected. Backend status polling is still active.')) return prev;
          return [...prev, {
            type: 'warning',
            text: 'Live log stream disconnected. Backend status polling is still active.'
          }];
        });
        setJobHeartbeat(prev => ({
          ...prev,
          message: 'Log stream disconnected. Still checking backend data every 2 seconds.'
        }));
      };
      eventSourceRef.current.onmessage = (event) => {
        if (logConnectTimerRef.current) window.clearTimeout(logConnectTimerRef.current);
        logConnectTimerRef.current = null;
        const log = JSON.parse(event.data);
        if (log.type === "system_control" && (log.text === "ALL_DONE" || log.text === "SET_COMPLETE")) {
          eventSourceRef.current.close();
          // Set status immediately so spinner stops â€” don't wait for fetchFinalData
          setEngineProgress(100);
          setJobHeartbeat({ status: log.text === "ALL_DONE" ? 'completed' : 'waiting_for_next_set', rows: lastPolledRowsRef.current, message: 'Live stream completed. Loading rows into workspace...' });
          if (log.text === "ALL_DONE") setEngineStatus("idle");
          else setEngineStatus("completed"); // SET_COMPLETE â†’ show "Continue to next set"
          // FIX 1c: fetchFinalData called here â€” uses refs internally to avoid stale closure
          fetchFinalData(activeJobId, queueIdx);
          setAutoTimer(120);
        } else if (log.type === "progress") {
          setEngineProgress(parseInt(log.text, 10));
        } else if (log.type === "page_map_init") {
          setEnginePageMap({ total: log.data.total, pages: {} });
        } else if (log.type === "page_map_update") {
          setEnginePageMap(prev => ({ ...prev, pages: { ...prev.pages, [log.data.page]: log.data.status } }));
        } else if (log.type === "api_status") {
          if (!String(apiKeyStatus).includes('users')) setApiKeyStatus(log.text);
        } else if (log.type === "cross_validation") {
          setCrossValidation(log.data);
        } else if (log.type === "stats") {
          setEngineStats(log.data);
        } else {
          setEngineLogs(prev => [...prev, { ...log }]);
        }
      };
    } catch { }
  };

  // FIX 1d: fetchFinalData now reads from refs â€” never uses stale closure state
  const fetchFinalData = async (id, queueIdx, options = {}) => {
    try {
      const { markCompleted = true, switchToTab = true } = options;
      let serverData = [];
      let serverStatus = "";
      try {
        const res = await axios.get(`${API_BASE}/data/${id}`);
        serverData = res.data.parsed_data || [];
        serverStatus = res.data.status || "";
        setJobHeartbeat(prev => ({
          status: serverStatus || prev.status || 'loaded',
          rows: serverData.length,
          message: serverData.length > 0 ? 'Rows loaded into workspace.' : prev.message
        }));
      } catch (e) {
        // /data/{job_id} 404 â€” job state missing (server restart, Redis expiry, etc.)
        // Preserve whatever is already in our matrices rather than wiping it.
        if (e?.response?.status === 404) return;
        throw e;
      }
      // Use refs instead of captured closure values
      const newMatrices = { ...latestMatricesRef.current };
      const newOpenTabs = [...latestOpenTabsRef.current ];
      const newHistory  = { ...latestHistoryRef.current };
      let lastTabId = activeTab;
      const groupedData = {};
      repairDuplicateQuestionNumbers(serverData).forEach((row, rowIndex) => {
        const s = row['SET Name'] || 'A';
        if (!groupedData[s]) groupedData[s] = [];
        const stableId = stableRowId(id, s, row, rowIndex + 1);
        groupedData[s].push(normalizeHeaderQuestionFields({ ...row, id: stableId, 'Is_Verified': row['Is_Verified'] || 'No' }));
      });
      Object.keys(groupedData).forEach(setName => {
        let uniqueTabId = `engine-${id}-${setName}`;
        let subjectName = groupedData[setName][0]['Subject Name'] || `Doc ${queueIdx + 1}`;
        if (!newMatrices[uniqueTabId]) {
          newMatrices[uniqueTabId] = groupedData[setName];
          newOpenTabs.push({ id: uniqueTabId, label: `${subjectName} (Set ${setName})`, jobId: id, setName, qpName: groupedData[setName][0]['NIOS Filename'] || 'Unknown' });
          newHistory[uniqueTabId] = { past: [], future: [] };
          lastTabId = uniqueTabId;
        } else {
          const existingData = [...newMatrices[uniqueTabId]];
          const mergedData = [];
          const incomingIds = new Set();
          groupedData[setName].forEach(incomingRow => {
            // FIX BUG B: if the user deleted this row, never add it back regardless of server state
            const incomingFingerprint = rowFingerprint(incomingRow);
            if (deletedRowIdsRef.current.has(incomingRow.id) || deletedRowFingerprintsRef.current.has(incomingFingerprint)) {
              // Also remove it from existingData in case stale latestMatricesRef snuck it in
              const staleIdx = existingData.findIndex(r => r.id === incomingRow.id || rowFingerprint(r) === incomingFingerprint);
              if (staleIdx !== -1) existingData.splice(staleIdx, 1);
              return;
            }
            incomingIds.add(incomingRow.id);
            const existingIndex = existingData.findIndex(r => r.id === incomingRow.id);
            if (existingIndex === -1) {
              mergedData.push(incomingRow);
            } else {
              const hasLocalEdits = Object.keys(editedCells).some(key => key.startsWith(`${uniqueTabId}-${incomingRow.id}`));
              mergedData.push(hasLocalEdits
                ? existingData[existingIndex]
                : { ...incomingRow, 'Is_Verified': existingData[existingIndex]['Is_Verified'] || 'No' });
            }
          });
          existingData.forEach(localRow => {
            const localFingerprint = rowFingerprint(localRow);
            if (incomingIds.has(localRow.id)) return;
            if (deletedRowIdsRef.current.has(localRow.id) || deletedRowFingerprintsRef.current.has(localFingerprint)) return;
            mergedData.push(localRow);
          });
          newMatrices[uniqueTabId] = mergedData;
        }
      });
      setMatrices(newMatrices);
      setOpenTabs(newOpenTabs);
      setHistory(newHistory);
      if (markCompleted) setEngineStatus("completed");
      if (switchToTab && serverData.length > 0) {
        setActiveTab(prevTab => {
          const currentHasRows = Array.isArray(newMatrices[prevTab]) && newMatrices[prevTab].length > 0;
          if (prevTab === 'engine' || !currentHasRows) return lastTabId;
          if (markCompleted) showToast(`Extraction Complete! New data ready in tabs.`);
          return prevTab;
        });
      }
      return { rows: serverData.length, status: serverStatus };
    } catch { }
  };

  const exportData = async () => {
    if (activeTab === 'engine') return;
    const activeTabInfo = openTabs.find(t => t.id === activeTab);
    if (!activeTabInfo) return;
    const exportIssues = validateRowsForExport(rawActiveData);
    if (exportIssues.length > 0) {
      const preview = exportIssues.slice(0, 12).join('\n');
      const extra = exportIssues.length > 12 ? `\n...and ${exportIssues.length - 12} more issue(s).` : '';
      const proceed = window.confirm(`Export validation found ${exportIssues.length} issue(s):\n\n${preview}${extra}\n\nDownload anyway?`);
      if (!proceed) return;
    }
    setIsDownloading(true);
    try {
      const response = await axios.post(`${API_BASE}/export-zip/${activeTabInfo.jobId}`, { set_name: activeTabInfo.setName, data: rawActiveData }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Verified_SET_${activeTabInfo.setName}_${activeTabInfo.jobId.substring(0, 6)}.zip`);
      document.body.appendChild(link); link.click(); link.parentNode.removeChild(link);
    } catch {
      addToExportQueue({ jobId: activeTabInfo.jobId, set_name: activeTabInfo.setName, data: rawActiveData });
      showToast('âš ï¸ Backend unreachable. Export queued for retry.');
    } finally { setIsDownloading(false); }
  };

  const clearWorkspace = () => {
    setEngineFiles([]); setCurrentQueueIdx(0); setAutoTimer(null);
    setEngineStatus("idle"); setEngineJobId(null); setEngineLogs(INITIAL_INSTRUCTIONS);
    setEngineProgress(0); setOpenTabs([]);
    setJobHeartbeat({ status: 'idle', rows: 0, message: 'Waiting' });
    lastPolledRowsRef.current = 0;
    setMatrices({}); setHistory({}); setActiveTab("engine"); setEditedCells({});
    setEnginePageMap({ total: 0, pages: {} }); setCustomColumns([]);
    setApiKeyStatus("Initializing..."); setCrossValidation(null);
    if (eventSourceRef.current) eventSourceRef.current.close();
  };

  const openReviewAtId = useCallback((rowId) => {
    setHighlightedRowId(rowId);
    setIsVerifyOpen(false);
    setReviewModalConfig({ isOpen: true, rowId });
    setTimeout(() => setHighlightedRowId(null), 3000);
  }, []);

  const activeTabInfo = openTabs.find(t => t.id === activeTab);

  const renderMiniMap = () => {
    if (enginePageMap.total === 0) return null;
    const blocks = [];
    for (let i = 1; i <= enginePageMap.total; i++) {
      let statusColor = "bg-slate-700/50 border-slate-600";
      const pStatus = enginePageMap.pages[i];
      if (pStatus === 'scanning') statusColor = "bg-blue-400 border-blue-300 animate-pulse shadow-[0_0_10px_rgba(96,165,250,0.6)]";
      else if (pStatus === 'done') statusColor = "bg-emerald-500 border-emerald-400 shadow-[0_0_5px_rgba(16,185,129,0.3)]";
      else if (pStatus === 'bypassed') statusColor = "bg-slate-400 border-slate-300";
      blocks.push(<div key={i} className={`w-2.5 h-2.5 rounded-[2px] border transition-colors duration-500 ${statusColor}`} title={`Page ${i}: ${pStatus || 'pending'}`} />);
    }
    return <div className="flex flex-wrap gap-1 px-4 pb-3 pt-2 bg-white border-b border-slate-200">{blocks}</div>;
  };

  const handleReviewAction = (action, payload, activeRow) => {
    if (action === 'crop_qp' || action === 'crop_ms') setCropModalConfig({ isOpen: true, rowData: activeRow, column: payload });
    else setScanModalConfig({ isOpen: true, rowData: activeRow, column: payload });
  };

  return (
    <div className="h-screen w-full bg-slate-50 flex flex-col font-sans text-slate-800 overflow-hidden relative selection:bg-blue-200" onClick={() => setIsVerifyOpen(false)}>

      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm flex-shrink-0 z-50">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex items-center gap-3 pr-4 border-r border-slate-200 shrink-0">
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-sm"><Activity className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight text-slate-800">DataParser</h1>
              <p className="text-[10px] text-blue-600 font-bold tracking-widest uppercase">ENGINE</p>
            </div>
          </div>
          <button onClick={() => {
            if (engineStatus === 'processing' && !window.confirm('Extraction is running. Open tools anyway?')) return;
            navigate('/');
          }} className="px-3 py-1.5 bg-white text-slate-600 hover:bg-slate-100 font-bold text-xs rounded-lg border border-slate-200 shadow-sm">
            Tools
          </button>
          <button onClick={() => {
            if (engineStatus === 'processing' && !window.confirm('Extraction is running. Open Question Crafter anyway?')) return;
            navigate('/question-crafter');
          }} className="px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-bold text-xs rounded-lg border border-emerald-200 shadow-sm">
            Question Crafter
          </button>
          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 shrink-0">
            <Key className="w-3 h-3 text-emerald-500" />
            <span className="text-xs font-bold text-slate-500">Live: <span className="text-slate-800">{apiKeyStatus}</span></span>
          </div>
          {toast && (
            <div className="fixed bottom-6 right-6 px-6 py-4 rounded-xl shadow-2xl z-[9999] bg-emerald-600 text-white font-bold flex items-center gap-3 border border-emerald-500 animate-fade-in-up">
              <CheckCircle2 className="w-6 h-6" />{toast}
            </div>
          )}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg border border-blue-200 shrink-0 mr-2">
            <Database className="w-3 h-3 text-blue-500" />
            <span className="text-xs font-bold text-blue-600">Windows: <span className="text-blue-800 font-black">{openTabs.length}</span></span>
          </div>
          <div className="flex gap-1 mt-1 overflow-x-auto custom-scrollbar flex-nowrap items-end pb-1 flex-1 scroll-smooth">
            <button onClick={() => setActiveTab('engine')} className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-t-lg text-sm font-bold border-b-2 transition-all ${activeTab === 'engine' ? 'bg-blue-50 border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>
              <div className="flex items-center gap-2">Engine Room {engineStatus === 'processing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}</div>
            </button>
            {openTabs.map(tab => {
              const p = tabProgress[tab.id] || { verified: 0, total: 0 };
              return (
                <div key={tab.id} title={`QP File: ${tab.qpName || 'Document'}`}
                  className={`shrink-0 whitespace-nowrap flex items-center px-4 py-2 rounded-t-lg border-b-2 cursor-pointer transition-all ${activeTab === tab.id ? 'bg-blue-50 border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}
                  onClick={() => setActiveTab(tab.id)}>
                  <Database className="w-3.5 h-3.5 mr-2" />
                  {editingTabId === tab.id
                    ? <input autoFocus type="text" value={editingTabName} onChange={(e) => setEditingTabName(e.target.value)}
                      onBlur={() => saveTabName(tab.id)} onKeyDown={(e) => { if (e.key === 'Enter') saveTabName(tab.id); if (e.key === 'Escape') setEditingTabId(null); }}
                      className="text-sm font-bold mr-3 bg-white text-slate-800 border border-blue-400 rounded px-1 outline-none w-32 shadow-inner"
                      onClick={(e) => e.stopPropagation()} />
                    : <span className="text-sm font-bold mr-2 hover:text-blue-500" title="Double-click to rename"
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingTabId(tab.id); setEditingTabName(tab.label); }}>
                      {tab.label}
                    </span>
                  }
                  <ProgressRing verified={p.verified} total={p.total} />
                  <span className="text-[10px] text-slate-400 ml-1 mr-2">{p.verified}/{p.total}</span>
                  <button onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} className="hover:text-red-500 text-lg leading-none">&times;</button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <button onClick={async () => {
            // Step 1: Push current React data to server (recreates job state if server restarted)
            const activeTabInfo = openTabs.find(t => t.id === activeTab);
            const jid = activeTab === 'engine' ? engineJobId : activeTabInfo?.jobId;
            if (!jid) { alert("No active extraction linked."); return; }

            const dataToSync = latestDataRef.current[activeTab] || [];
            if (dataToSync.length > 0) {
              try {
                await axios.post(`${API_BASE}/sync-db/${jid}`, { parsed_data: dataToSync });
              } catch { /* backend will create job state if missing */ }
            }

            // Step 2: Force-save workspace to Redis (including full matrices)
            try {
              const workspaceSnap = {
                dp_activeTab: activeTab,
                dp_openTabs: openTabs,
                dp_editedCells: editedCells,
                dp_engineJobId: engineJobId,
                dp_customCols: customColumns,
                dp_matrices: latestMatricesRef.current
              };
              await axios.post(`${API_BASE}/redis/save`, { workspace: workspaceSnap });
            } catch { /* silent */ }

            // Step 3: Fetch from server to confirm (merges any new rows since last fetch)
            fetchFinalData(jid, currentQueueIdx);
          }} className="px-4 py-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Sync
          </button>
          <button onClick={() => setShowImportModal(true)} className="px-4 py-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2">
            <FolderUp className="w-4 h-4" /> Import
          </button>
          <button onClick={() => {
            if (engineStatus === 'processing' && !window.confirm('Extraction is running. Clear everything and cancel?')) return;
            clearWorkspace();
          }} className="px-4 py-2 bg-white hover:bg-red-50 border border-slate-300 hover:border-red-200 text-slate-600 hover:text-red-600 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-row min-h-0 overflow-hidden relative z-10">
        <div className={`flex flex-col bg-slate-50 shadow-[4px_0_20px_rgba(0,0,0,0.05)] min-h-0 z-20 transition-all duration-500 ease-in-out overflow-hidden ${activeTab !== 'engine' ? "w-0 opacity-0 border-r-0" : "w-full opacity-100"}`}>
          <div className="p-4 gap-4 flex flex-col h-full overflow-y-auto custom-scrollbar max-w-3xl mx-auto w-full">
            <div className="flex-shrink-0 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="relative border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50 hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer group">
                <input type="file" multiple accept="application/pdf" onChange={handleQueueDrop} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={engineStatus === "processing"} />
                <Upload className="w-6 h-6 text-blue-500 mx-auto mb-2 group-hover:scale-110 transition-all" />
                <p className="text-xs font-bold text-slate-500">Drop Multiple PDFs Here (Master Queue)</p>
              </div>
              <div className="mt-3 flex items-center justify-between bg-slate-100 p-2 rounded border border-slate-200">
                <label className="text-xs font-bold text-slate-600">Target Extraction:</label>
                <select value={selectedTargetSet} onChange={(e) => setSelectedTargetSet(e.target.value)}
                  className="text-xs border border-slate-300 rounded px-2 py-1 bg-white outline-none cursor-pointer" disabled={engineStatus === "processing"}>
                  <option value="ALL">All Sets (A, B, C)</option>
                  <option value="A">Set A Only</option>
                  <option value="B">Set B Only</option>
                  <option value="C">Set C Only</option>
                </select>
              </div>
              {engineFiles.length > 0 && (
                <div className="max-h-24 overflow-y-auto mt-3 space-y-2 custom-scrollbar">
                  {engineFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded shadow-sm">
                      <span className="text-[11px] font-bold text-slate-600 truncate mr-2">{f.name}</span>
                      <button onClick={() => setEngineFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              {queuedPairs.length > 0 && (
                <div className="mt-2 text-xs font-bold text-emerald-700 bg-emerald-50 p-2 rounded border border-emerald-200 flex items-center justify-between shadow-sm">
                  <span>Ready: {queuedPairs.length} QP document(s), {queuedPairs.filter(pair => pair.ms).length} MS mapped</span>
                  {engineStatus === 'processing' && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing Document {currentQueueIdx + 1}</span>}
                </div>
              )}
              {engineJobId && (
                <div className="mt-2 text-xs font-bold text-blue-700 bg-blue-50 p-2 rounded border border-blue-200 flex items-center justify-between shadow-sm">
                  <span className="flex items-center gap-2">
                    {engineStatus === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    Backend: {jobHeartbeat.status}
                  </span>
                  <span className="text-blue-900">{jobHeartbeat.rows} row(s) - {jobHeartbeat.message}</span>
                </div>
              )}
            </div>

            {crossValidation && (
              <div className={`flex-shrink-0 rounded-xl px-4 py-2.5 border flex items-center justify-between text-xs font-bold ${crossValidation.gap > 2 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-emerald-50 border-emerald-300 text-emerald-700'}`}>
                <div className="flex items-center gap-2"><BarChart2 className="w-4 h-4" />Cross-Validation Set {crossValidation.set}: QP {crossValidation.qp_count} | MS {crossValidation.ms_count} | Gap {crossValidation.gap}</div>
                {crossValidation.gap > 2 && <span className="text-[10px] font-black text-amber-700 bg-amber-200 px-2 py-0.5 rounded">REVIEW GAPS</span>}
              </div>
            )}

            <div className="flex-shrink-0">
              <div className="flex gap-2 w-full flex-col">
                {autoTimer !== null && (
                  <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 flex justify-between items-center mb-2 shadow-sm">
                    <div className="flex items-center gap-2 text-amber-700 font-bold">
                      <Clock className="w-5 h-5 animate-pulse" />
                      <span>Auto-advancing to Next Pair in: <span className="text-xl mx-1">{Math.floor(autoTimer / 60)}:{(autoTimer % 60).toString().padStart(2, '0')}</span></span>
                    </div>
                    <button onClick={handleNextFilePair} className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded shadow text-sm font-bold flex items-center gap-1">
                      <SkipForward className="w-4 h-4" /> Skip Now
                    </button>
                  </div>
                )}
                <div className="flex gap-2 w-full">
                  {engineStatus === "idle" || engineStatus === "error" ? (
                    <button onClick={() => startEngine("A", currentQueueIdx)} disabled={queuedPairs.length === 0 || currentQueueIdx >= queuedPairs.length}
                      className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-slate-300 flex items-center justify-center gap-2 shadow-md">
                      <Play className="w-4 h-4 fill-current" /> Run Queue (Document {currentQueueIdx + 1})
                    </button>
                  ) : engineStatus === "completed" ? (
                    <>
                      <button onClick={() => startEngine("B", currentQueueIdx)} className="flex-1 py-3 bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-xl font-bold hover:bg-indigo-200 shadow-sm flex items-center justify-center gap-2">
                        <Play className="w-4 h-4 fill-current" /> Next: Set B
                      </button>
                      <button onClick={() => startEngine("C", currentQueueIdx)} className="flex-1 py-3 bg-fuchsia-100 border border-fuchsia-200 text-fuchsia-700 rounded-xl font-bold hover:bg-fuchsia-200 shadow-sm flex items-center justify-center gap-2">
                        <Play className="w-4 h-4 fill-current" /> Next: Set C
                      </button>
                    </>
                  ) : (
                    <>
                      <button disabled className="flex-1 py-3 bg-slate-200 text-slate-500 rounded-xl font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                        <Loader2 className="w-4 h-4 animate-spin" /> Extracting in Background...
                      </button>
                      <button onClick={async () => {
                        if (!engineJobId) return;
                        await axios.post(`${API_BASE}/cancel/${engineJobId}`);
                        setEngineStatus("idle");
                        if (eventSourceRef.current) eventSourceRef.current.close();
                        setEngineLogs(prev => [...prev, { type: 'system_control', text: 'ENGINE HALTED BY USER.' }]);
                        setAutoTimer(null);
                        fetchFinalData(engineJobId, currentQueueIdx);
                      }} className="px-6 py-3 bg-red-100 border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-200 flex items-center justify-center gap-2">
                        <Square className="w-4 h-4 fill-current" /> Stop
                      </button>
                    </>
                  )}
                  <button onClick={resetEngine} className="px-4 py-3 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600 rounded-xl font-bold shadow-sm flex items-center justify-center border border-slate-200" title="Clear Terminal & Queue">
                    <Power className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col bg-black rounded-xl border border-slate-800 shadow-xl overflow-hidden relative min-h-[250px] shrink-0">
              {engineStatus === "processing" && <div className="absolute top-0 left-0 h-[3px] bg-cyan-400 z-50 transition-all duration-500 shadow-[0_0_10px_rgba(34,211,238,0.8)]" style={{ width: `${engineProgress}%` }}></div>}
              <div className="bg-black px-4 py-2.5 border-b border-slate-800 flex justify-between items-center shadow-md z-10 flex-shrink-0 mt-1">
                <span className="font-bold text-slate-400 tracking-widest text-[10px] font-mono flex items-center gap-2"><Activity className="w-3 h-3 text-cyan-400 animate-pulse" /> X-RAY TUNNEL</span>
                {engineStatus === "processing" && <span className="text-cyan-400 font-bold text-[10px]">{engineProgress}%</span>}
              </div>
              {renderMiniMap()}
              <div className="p-3.5 overflow-y-auto flex-1 custom-scrollbar space-y-2 bg-black text-[11px] min-h-0 text-slate-300 font-mono">
                {engineLogs.map((log, i) => (
                  <div key={i} className={`p-2 rounded bg-opacity-80 border-l-2 ${log.type === 'error' ? 'text-rose-400 border-rose-500/50 bg-rose-950/20' : log.type === 'warning' ? 'text-amber-400 border-amber-500/50 bg-amber-950/20' : log.type === 'success' ? 'text-emerald-400 border-emerald-500/50 bg-emerald-950/20' : 'border-slate-700 bg-slate-900/50'}`}>
                    {cleanLogText(log.text)}
                  </div>
                ))}
                <div ref={logsEndRef} className="h-2" />
              </div>
            </div>
          </div>
        </div>

        <div className={`flex flex-col bg-white min-w-0 p-4 gap-4 transition-all duration-500 ease-in-out z-10 ${activeTab !== 'engine' ? 'w-full' : 'hidden'}`}>
          <div className="flex flex-wrap justify-between items-center bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-sm flex-shrink-0 gap-3">
            <div className="flex gap-5 items-center pl-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Active Rows</span>
                <span className="text-xl font-black text-slate-700 leading-none mt-1">
                  {activeTab === 'engine' ? engineStats.parsed : activeData.length}
                  {showUnverifiedOnly && rawActiveData.length !== activeData.length && <span className="text-sm font-normal text-slate-400"> / {rawActiveData.length}</span>}
                </span>
              </div>
              {activeTab !== 'engine' && (
                <>
                  <div className="w-px h-8 bg-slate-200 hidden sm:block"></div>
                  <div className="flex gap-2">
                    <button onClick={undo} disabled={!history[activeTab] || history[activeTab].past.length === 0} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 shadow-sm"><Undo className="w-4 h-4" /></button>
                    <button onClick={redo} disabled={!history[activeTab] || history[activeTab].future.length === 0} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 shadow-sm"><Redo className="w-4 h-4" /></button>
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5 pr-1">
              {activeTab !== 'engine' && (
                <>
                  {/* View toggle */}
                  <div className="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 p-1 rounded-lg">
                    {[['list', 'List'], ['verify', 'Verify'], ['full', 'Grid']].map(([m, l]) => (
                      <button key={m} onClick={() => setColumnMode(m)}
                        className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${columnMode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        {m === 'list' && <List className="w-3 h-3 inline mr-1" />}
                        {m === 'verify' && <Columns className="w-3 h-3 inline mr-1" />}
                        {l}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowUnverifiedOnly(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${showUnverifiedOnly ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'}`}>
                    <Filter className="w-3.5 h-3.5" />{showUnverifiedOnly ? 'All Rows' : 'Unverified'}
                  </button>
                  <button onClick={deleteUnansweredDuplicates} className="px-3 py-2 bg-amber-50 text-amber-700 rounded-lg font-bold hover:bg-amber-100 flex items-center gap-2 text-xs border border-amber-200 shadow-sm">
                    <Trash2 className="w-3.5 h-3.5" /> Delete Duplicates
                  </button>
                  <button onClick={bulkMarkOption1} className="px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg font-bold hover:bg-emerald-100 flex items-center gap-2 text-xs border border-emerald-200 shadow-sm">
                    <Check className="w-3.5 h-3.5" /> Bulk Mark
                  </button>
                  <button onClick={() => setShowFindReplace(true)} className="px-3 py-2 bg-violet-50 text-violet-700 rounded-lg font-bold hover:bg-violet-100 flex items-center gap-2 text-xs border border-violet-200 shadow-sm">
                    <Replace className="w-3.5 h-3.5" /> Find & Replace
                  </button>
                  <button onClick={handleAddColumn} className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg font-bold hover:bg-blue-100 flex items-center gap-2 text-xs border border-blue-200 shadow-sm">
                    <Plus className="w-3.5 h-3.5" /> Add Column
                  </button>
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setIsVerifyOpen(true); 
                    }} 
                    className="px-3 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-bold hover:bg-slate-50 flex items-center gap-2 text-xs shadow-sm">
                    Verify
                  </button>
                  <button onClick={exportData} disabled={rawActiveData.length === 0 || isDownloading}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 flex items-center gap-2 text-xs shadow-sm disabled:opacity-50">
                    {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-slate-200 rounded-xl shadow-sm min-h-0 relative">
            {activeTab === 'engine' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                <Database className="w-14 h-14 mb-4 opacity-50" />
                <p className="font-bold text-lg">Engine Dashboard Active</p>
              </div>
            ) : activeData.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <p className="font-bold">Loading workspace rows...</p>
                <button
                  onClick={() => activeTabInfo?.jobId && fetchFinalData(activeTabInfo.jobId, currentQueueIdx, { markCompleted: false, switchToTab: false })}
                  className="px-3 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-bold text-xs hover:bg-blue-100"
                >
                  Reload from backend
                </button>
              </div>
            ) : columnMode === 'list' ? (
              <table className="min-w-full divide-y divide-slate-200 text-sm border-collapse">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm border-b border-slate-200">
                  <tr>
                    <th className="p-4 text-center font-bold text-slate-500 w-16 uppercase text-[10px] tracking-wider">Q.No</th>
                    <th className="p-4 text-left font-bold text-slate-500 uppercase text-[10px] tracking-wider">Question Preview</th>
                    <th className="p-4 text-left font-bold text-slate-500 uppercase text-[10px] tracking-wider w-40">Status</th>
                    <th className="p-4 text-right font-bold text-slate-500 uppercase text-[10px] tracking-wider w-24">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {activeData.map(row => (
                    <CleanDataRow key={row.id} row={row} isSelected={highlightedRowId === row.id} onSelect={(id) => openReviewAtId(id)} />
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-max min-w-full divide-y divide-slate-200 text-sm border-separate border-spacing-0 table-fixed">
                <thead>
                  <tr className="text-slate-600 bg-slate-100/90">
                    <th className="sticky top-0 left-0 bg-slate-100 z-50 px-2 py-3 w-16 text-center border-b border-r border-slate-300">Act</th>
                    {visibleColumns.map((h) => {
                      const isSlNo = h === 'Sl.No';
                      const isQText = h === 'Question text(Mandatory)';
                      return (
                        <th key={h} className={`sticky top-0 bg-slate-100/95 z-40 px-4 py-3 font-extrabold text-[11px] uppercase whitespace-nowrap border-b border-r border-slate-300
                          ${isSlNo ? 'left-[64px] min-w-[60px] text-center z-50' : 'text-left'}
                          ${isQText ? 'min-w-[300px] max-w-[420px]' : ''}`}>
                          {h === 'Is_Verified' ? <Check className="w-3.5 h-3.5 mx-auto text-emerald-600" /> : h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="bg-transparent">
                  {activeData.map((row) => {
                    const realIdx = rawActiveData.findIndex(r => r.id === row.id);
                    return (
                      <MemoizedDataRow key={row.id} row={row} rowIndex={realIdx} visibleColumns={visibleColumns}
                        viewMode={viewMode} activeTab={activeTab} jobId={activeTabInfo?.jobId}
                        editedCells={editedCells} insertRow={insertRow} deleteRow={deleteRow}
                        handleDataChange={(_, col, val) => handleDataChange(row.id, col, val)}
                        setCropModalConfig={setCropModalConfig} setImagePreviewConfig={setImagePreviewConfig}
                        openReviewAtId={openReviewAtId} highlightedRowId={highlightedRowId} />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {showImportModal && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-4">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-800"><FolderUp className="w-6 h-6 text-blue-600" /> Restore Session</h2>
              <button onClick={() => { setShowImportModal(false); setImportFiles([]); }} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-500 hover:text-red-500 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="relative border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 hover:bg-blue-50/50 hover:border-blue-400 cursor-pointer group mb-6">
              <input type="file" multiple accept="application/pdf, .xlsx, .xls, .zip" onChange={(e) => setImportFiles(prev => [...prev, ...Array.from(e.target.files)])} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <Upload className="w-8 h-8 text-blue-500 mx-auto mb-3 group-hover:scale-110" />
              <p className="font-bold text-slate-500">Drop Excel, PDFs, AND Downloaded .ZIP here</p>
            </div>
            {importFiles.length > 0 && (
              <div className="max-h-32 overflow-y-auto mb-6 space-y-2 border border-slate-200 p-2 rounded-lg bg-slate-50 custom-scrollbar">
                {importFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded shadow-sm text-xs font-bold text-slate-600">
                    {f.name}
                    <button onClick={() => setImportFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-3 mt-auto border-t border-slate-200 pt-4">
              <button onClick={() => { setShowImportModal(false); setImportFiles([]); }} className="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={executeWorkspaceRestore} disabled={isImporting || !importFiles.find(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))}
                className="px-8 py-2.5 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-2 shadow-md">
                {isImporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Import & Edit
              </button>
            </div>
          </div>
        </div>
      )}

      <VerifyDashboard isOpen={isVerifyOpen} onClose={() => setIsVerifyOpen(false)} activeData={rawActiveData} openModalAtId={openReviewAtId} />

      <ReviewModal isOpen={reviewModalConfig.isOpen} initialRowId={reviewModalConfig.rowId}
        data={rawActiveData} jobId={activeTabInfo?.jobId} flaggedIds={flaggedIds}
        onClose={() => setReviewModalConfig({ isOpen: false, rowId: null })}
        onUpdate={handleDataChangeMulti}
        onImagePreview={(imgUrl, rowData) => setImagePreviewConfig({ isOpen: true, imageUrl: imgUrl, baseName: rowData['NIOS Filename'] })}
        onTriggerScanner={(column, action, activeRow) => handleReviewAction(action, column, activeRow)}
        insertRow={insertRow} deleteRow={deleteRow} />

      <ManualCropModal isOpen={cropModalConfig.isOpen} jobId={activeTabInfo?.jobId}
        rowData={cropModalConfig.rowData} columnToUpdate={cropModalConfig.column}
        onClose={() => setCropModalConfig({ ...cropModalConfig, isOpen: false })}
        onCropComplete={(newFilename, rowId, column) => { handleDataChangeMulti(rowId, { [column]: newFilename, 'MS_Diagram_Flag': 'No' }); }} />

      <TextScannerModal isOpen={scanModalConfig.isOpen} jobId={activeTabInfo?.jobId}
        rowData={scanModalConfig.rowData} columnToUpdate={scanModalConfig.column}
        onClose={() => setScanModalConfig({ ...scanModalConfig, isOpen: false })}
        onScanComplete={(extractedText, rowId, column) => { handleDataChangeMulti(rowId, { [column]: extractedText }); }} />

      <ImagePreviewModal isOpen={imagePreviewConfig.isOpen} imageUrl={imagePreviewConfig.imageUrl}
        baseName={imagePreviewConfig.baseName} jobId={activeTabInfo?.jobId}
        onClose={() => setImagePreviewConfig({ isOpen: false, imageUrl: null, baseName: null })} />

      <FindReplaceModal isOpen={showFindReplace} onClose={() => setShowFindReplace(false)}
        activeData={rawActiveData} visibleColumns={visibleColumns} onApply={handleFindReplace} />

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .animate-fade-in-up { animation: fadeInUp 0.3s ease-out forwards; }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeInUp 0.2s ease-out forwards; }
      `}} />
    </div>
  );
}

