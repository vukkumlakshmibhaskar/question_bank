import React, { useEffect, useMemo, useState } from 'react';
import {AlertTriangle,BarChart3,BookOpen,Brain,
  Check,CheckCircle2,ChevronLeft,ChevronRight,Columns,Database,
  Download,Eye,FileText,Filter,List,ListChecks,Loader2,PenLine,Crop,
  RefreshCw,Replace,Search,ShieldCheck,Trash2,UploadCloud,X,
} from 'lucide-react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { qbankApiAssetUrl, qbankFetch, qbankWorkflowBase } from '../lib/qbankApi';

const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');
const DEFAULT_QUESTION_CRAFTER_API_BASE = qbankWorkflowBase('question-crafter');
const API_BASE = trimTrailingSlash(
  import.meta.env.VITE_QUESTION_CRAFTER_API_BASE ||
  window.__QUESTION_CRAFTER_API_BASE__ ||
  DEFAULT_QUESTION_CRAFTER_API_BASE
);
const apiUrl = (path) => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
const apiAssetUrl = (path) => qbankApiAssetUrl(API_BASE, path);
const QUESTION_CRAFTER_DRAFT_KEY = 'ads_question_crafter_draft_v1';
const loadQuestionCrafterDraft = () => {
  try {
    return JSON.parse(window.localStorage.getItem(QUESTION_CRAFTER_DRAFT_KEY) || 'null') || {};
  } catch {
    return {};
  }
};
const saveQuestionCrafterDraft = (draft) => {
  try {
    window.localStorage.setItem(QUESTION_CRAFTER_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // The draft can be too large for localStorage on very large books; generation still works in memory.
  }
};
const clearQuestionCrafterDraft = () => {
  try {
    window.localStorage.removeItem(QUESTION_CRAFTER_DRAFT_KEY);
  } catch {
    // Ignore storage errors; reset should still clear the current screen state.
  }
};
const SUPERSCRIPT_CHARS = {
  0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ",
  j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ",
  t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ",
  K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ", O: "ᴼ", P: "ᴾ", R: "ᴿ", T: "ᵀ",
  U: "ᵁ", V: "ⱽ", W: "ᵂ",
};
const toSuperscript = (value = "") => String(value).replace(/[A-Za-z0-9+\-=()]/g, (char) => SUPERSCRIPT_CHARS[char] || char);
const formatMathPowers = (value = "") => String(value)
  .replace(/(\([^()\n]+\)|[A-Za-z0-9]+)\s*\^\s*\(([^)\n]{1,30})\)/g, (_, base, power) => `${base}${toSuperscript(`(${power})`)}`)
  .replace(/(\([^()\n]+\)|[A-Za-z0-9]+)\s*\^\s*([A-Za-z0-9+\-=]{1,20})/g, (_, base, power) => `${base}${toSuperscript(power)}`);
const stripMarkdownFormatting = (value = "") => String(value)
  .replace(/\*\*([^*\n]+)\*\*/g, "$1")
  .replace(/__([^_\n]+)__/g, "$1")
  .replace(/`([^`\n]+)`/g, "$1")
  .replace(/^\s*[-*]\s+/gm, "")
  .replace(/^(\s*\d+\.)\s*\*\*([^*\n]+)\*\*:?/gm, "$1 $2:")
  .replace(/^\s*\*\s*/gm, "")
  .replace(/\*{2,}/g, "");
const polishText = (value = "") => stripMarkdownFormatting(formatMathPowers(value)).replace(/\n{3,}/g, "\n\n").trim();
const polishRowText = (row = {}) => ({
  ...row,
  question: polishText(row.question || ""),
  "AI answer": polishText(row["AI answer"] || ""),
});

const QUESTION_TYPES = [
  { id: 'objective', label: 'MCQ', icon: ListChecks },
  { id: 'very_short', label: 'Very short', icon: PenLine },
  { id: 'short', label: 'Short', icon: FileText },
  { id: 'long', label: 'Long', icon: BookOpen },
  { id: 'elaborative', label: 'Elaborative', icon: Brain },
  { id: 'fill_blank', label: 'Fill blanks', icon: PenLine },
  { id: 'true_false', label: 'True / False', icon: CheckCircle2 },
  { id: 'paragraph', label: 'Paragraph', icon: FileText },
  { id: 'diagram', label: 'Diagram', icon: Brain },
  { id: 'graph', label: 'Graph', icon: BarChart3 },
];

const BLOOM_TAGS = ['knowledge', 'understanding', 'application', 'analysis', 'evaluation', 'creation'];
const COLUMNS = ['question_number', 'question_type', 'question', 'AI answer', 'bloom_tag', 'difficulty', 'lesson_no', 'lesson_name', 'subject_name', 'source_page', 'source_image_url', 'source_excerpt'];
const isVisualRow = (row = {}) => {
  const type = String(row.question_type || '').trim().toLowerCase();
  return type === 'diagram' || type === 'graph';
};
const imageFileName = (url = '') => {
  const clean = String(url || '').split('?', 1)[0];
  return clean.startsWith('/textbook-crops/') ? clean.split('/').pop() : '';
};
const needsGivenImage = (row = {}) => isVisualRow(row)
  && /\b(?:given|shown|attached|provided)\s+(?:diagram|graph|chart|figure|image)\b/i.test(String(row.question || ''));
const rowReviewMessages = (row = {}, requireAnswers = true) => {
  const messages = [];
  if (!String(row.question || '').trim()) messages.push('Missing Question');
  if (requireAnswers && !String(row['AI answer'] || '').trim()) messages.push('Missing Answer');
  if (needsGivenImage(row) && !imageFileName(row.source_image_url)) messages.push('Image Needs Review');
  if (row.review_status === 'Needs Review') messages.push('Needs Review');
  return messages;
};
const rowStatus = (row = {}, requireAnswers = true) => {
  const messages = rowReviewMessages(row, requireAnswers);
  if (messages.length) return { label: messages[0], tone: 'amber' };
  if (isVisualRow(row) && imageFileName(row.source_image_url)) return { label: 'Image Attached', tone: 'cyan' };
  if (isVisualRow(row) && !needsGivenImage(row)) return { label: 'No Image Needed', tone: 'slate' };
  if (row.review_status === 'Verified') return { label: 'Verified', tone: 'emerald' };
  return { label: 'Ready', tone: 'emerald' };
};

const issueCountFor = (rows, requireAnswers = true) => rows.filter((row) => {
  return rowReviewMessages(row, requireAnswers).length > 0;
}).length;

const progressFor = (rows) => {
  const total = rows.length || 0;
  const verified = rows.filter((row) => row.review_status === 'Verified').length;
  return { total, verified, pct: total ? Math.round((verified / total) * 100) : 0 };
};

function ProgressRing({ pct }) {
  const size = 26;
  const r = 10;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 90 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size}>
      <circle cx={13} cy={13} r={r} fill="none" stroke="#e2e8f0" strokeWidth="3" />
      <circle cx={13} cy={13} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 13 13)" />
    </svg>
  );
}

function VerifyDrawer({ open, reviewItems, requireAnswers, onClose, onOpenRow }) {
  const [filter, setFilter] = useState('problems');
  const issues = useMemo(() => reviewItems.map((item) => {
    const messages = rowReviewMessages(item.row, requireAnswers);
    const hasImage = Boolean(imageFileName(item.row.source_image_url));
    return { ...item, messages, hasImage };
  }).filter((item) => {
    if (filter === 'missing_answer') return item.messages.includes('Missing Answer');
    if (filter === 'image') return item.messages.includes('Image Needs Review');
    if (filter === 'unverified') return item.row.review_status !== 'Verified';
    return item.messages.length > 0;
  }), [reviewItems, requireAnswers, filter]);

  if (!open) return null;
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-[430px] flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-slate-800"><ShieldCheck className="h-5 w-5 text-teal-700" /> Review Queue</h2>
          <p className="text-xs text-slate-500">{issues.length} row(s) need attention across generated lessons</p>
        </div>
        <button className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose}><X className="h-5 w-5" /></button>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
        {[
          ['problems', 'Problems'],
          ['missing_answer', 'Missing answers'],
          ['image', 'Image review'],
          ['unverified', 'Unverified'],
        ].map(([id, label]) => (
          <button key={id} className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${filter === id ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`} onClick={() => setFilter(id)} type="button">
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {issues.length === 0 ? (
          <div className="mt-10 text-center text-sm text-slate-500">No rows found for this filter.</div>
        ) : issues.map(({ row, lessonNo, index, messages }) => (
          <button key={`${lessonNo}-${row.question_number}-${index}`} className="mb-2 w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-left hover:bg-amber-100" onClick={() => onOpenRow(lessonNo, index)}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-amber-800">{lessonNo} · Q{row.question_number}</span>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-1 text-xs font-semibold text-amber-700">{messages.length ? messages.join(', ') : rowStatus(row, requireAnswers).label}</div>
            <div className="mt-1 line-clamp-2 text-xs text-slate-600">{row.question}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CropGalleryModal({ lesson, approvedUrls, onChange, onClose }) {
  if (!lesson) return null;
  const pages = lesson.source_pages || [];
  const allCrops = pages.flatMap((page) => (page.crops || []).map((cropUrl) => ({ page: page.page, cropUrl })));
  const approvedSet = new Set(approvedUrls || allCrops.map((item) => item.cropUrl));
  const toggleCrop = (cropUrl) => {
    const next = new Set(approvedSet);
    if (next.has(cropUrl)) next.delete(cropUrl);
    else next.add(cropUrl);
    onChange(Array.from(next));
  };
  const selectAll = () => onChange(allCrops.map((item) => item.cropUrl));
  const clearAll = () => onChange([]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-5 backdrop-blur-sm">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0f172a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-cyan-300">{lesson.lesson_no}</div>
            <h2 className="text-lg font-black text-white">Review Possible Images</h2>
            <p className="text-xs text-slate-400">{approvedSet.size}/{allCrops.length} image(s) approved for diagram/graph generation</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-cyan-500/40 bg-cyan-900/40 px-3 py-2 text-xs font-bold text-cyan-100" type="button" onClick={selectAll}>Use All</button>
            <button className="rounded-md border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300" type="button" onClick={clearAll}>Ignore All</button>
            <button className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" type="button" onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {allCrops.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">No visual crops were detected for this lesson.</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {allCrops.map(({ page, cropUrl }, index) => {
                const approved = approvedSet.has(cropUrl);
                return (
                  <button
                    className={`overflow-hidden rounded-lg border text-left transition ${approved ? 'border-emerald-400 bg-emerald-950/30' : 'border-slate-700 bg-slate-950 opacity-60 hover:opacity-100'}`}
                    key={cropUrl}
                    type="button"
                    onClick={() => toggleCrop(cropUrl)}
                  >
                    <div className="flex h-40 items-center justify-center bg-white">
                      <img src={apiAssetUrl(cropUrl)} alt={`Possible image ${index + 1}`} className="max-h-40 w-full object-contain" />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-xs font-bold">
                      <span className="text-slate-200">Page {page} · Image {index + 1}</span>
                      <span className={approved ? 'text-emerald-300' : 'text-slate-500'}>{approved ? 'Use' : 'Ignore'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewModal({ open, rows, index, sessionId, sourcePages = [], onClose, onSave, onNavigate, onRegenerate }) {
  const row = rows[index];
  const [draft, setDraft] = useState(row || {});
  const [cropMode, setCropMode] = useState(false);
  const [cropSelection, setCropSelection] = useState();
  const [savingCrop, setSavingCrop] = useState(false);
  const [cropError, setCropError] = useState('');

  React.useEffect(() => setDraft(row || {}), [row]);
  if (!open || !row) return null;

  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const canAttachImage = isVisualRow(draft);
  const visualWorkspace = canAttachImage;
  const linkedImageFile = imageFileName(draft.source_image_url);
  const selectedPage = sourcePages.find((item) => item.image_url === draft.source_image_url)
    || sourcePages.find((item) => (item.crops || []).includes(draft.source_image_url))
    || sourcePages[0]
    || null;
  const selectedPageUrl = selectedPage?.image_url || '';
  const selectedPageCrops = selectedPage?.crops || [];
  const selectSourcePage = (imageUrl) => {
    const page = sourcePages.find((item) => item.image_url === imageUrl);
    if (!page) return;
    setDraft((current) => ({
      ...current,
      source_page: page.page || current.source_page || '',
      source_image_url: page.image_url,
      source_excerpt: current.source_excerpt || `Source page ${page.page || ''} selected for manual crop.`,
    }));
    setCropMode(false);
    setCropSelection(undefined);
  };
  const selectSourceCrop = (cropUrl, page) => {
    setDraft((current) => ({
      ...current,
      source_page: page.page || current.source_page || '',
      source_image_url: cropUrl,
      source_excerpt: 'Auto-cropped diagram/graph selected for this question.',
    }));
    setCropMode(false);
    setCropSelection(undefined);
  };
  const save = (status) => {
    onSave(index, { ...draft, review_status: status || draft.review_status || 'Verified' });
  };
  const canCropCurrentImage = String(draft.source_image_url || '').startsWith('/textbook-pages/');
  const saveCrop = async () => {
    if (!draft.source_image_url || !cropSelection?.width || !cropSelection?.height) return;
    setSavingCrop(true);
    setCropError('');
    try {
      const response = await qbankFetch(apiUrl('/crop-source-image'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          image_url: draft.source_image_url,
          crop: cropSelection,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Crop failed');
      setDraft((current) => ({ ...current, source_image_url: data.crop_url, source_excerpt: 'Manual diagram crop saved for this question.' }));
      setCropMode(false);
      setCropSelection(undefined);
    } catch (err) {
      setCropError(err.message);
    } finally {
      setSavingCrop(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-5 backdrop-blur-sm">
      <div className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0f172a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-violet-900/50 px-3 py-1 font-mono text-sm font-bold text-violet-200">Q {index + 1}/{rows.length}</span>
            <span className="rounded-md border border-slate-700 px-3 py-1 text-xs font-bold text-slate-300">{draft.lesson_no}</span>
            <span className="text-sm text-slate-400">{draft.question_type}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 disabled:opacity-40" disabled={index <= 0} onClick={() => onNavigate(index - 1)}><ChevronLeft className="inline h-4 w-4" /> Prev</button>
            <button className="rounded-md border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300 disabled:opacity-40" disabled={index >= rows.length - 1} onClick={() => onNavigate(index + 1)}>Next <ChevronRight className="inline h-4 w-4" /></button>
            <button className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={onClose}><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className={`grid flex-1 grid-cols-1 overflow-hidden ${visualWorkspace ? 'lg:grid-cols-[minmax(560px,54vw)_minmax(420px,1fr)]' : ''}`}>
          {visualWorkspace && (
          <aside className="overflow-y-auto border-r border-slate-800 bg-slate-900/50 p-5">
            {canAttachImage && sourcePages.length > 0 && (
              <div className="mb-4 rounded-lg border border-slate-700 bg-slate-950 p-3">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Question image</label>
                <select
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  value={selectedPageUrl}
                  onChange={(event) => selectSourcePage(event.target.value)}
                >
                  <option value="">Choose textbook page</option>
                  {sourcePages.map((page) => (
                    <option value={page.image_url} key={page.image_url}>
                      Page {page.page}{page.crops?.length ? ` - ${page.crops.length} image choice(s)` : ''}
                    </option>
                  ))}
                </select>
                {selectedPageCrops.length > 0 ? (
                  <div className="mt-3 grid max-h-56 grid-cols-2 gap-3 overflow-y-auto pr-1 xl:grid-cols-3">
                    {selectedPageCrops.map((cropUrl, cropIndex) => {
                      const isSelected = draft.source_image_url === cropUrl;
                      return (
                        <button
                          className={`group overflow-hidden rounded-lg border text-left transition ${isSelected ? 'border-emerald-400 bg-emerald-950/30' : 'border-cyan-800 bg-cyan-950/30 hover:border-cyan-400'}`}
                          key={`${selectedPage.image_url}-${cropUrl}`}
                          type="button"
                          onClick={() => selectSourceCrop(cropUrl, selectedPage)}
                        >
                          <div className="flex h-28 items-center justify-center bg-white">
                            <img src={apiAssetUrl(cropUrl)} alt={`Image choice ${cropIndex + 1}`} className="max-h-28 w-full object-contain" />
                          </div>
                          <div className="flex items-center justify-between px-2.5 py-2 text-[11px] font-bold text-cyan-100">
                            <span>Image {cropIndex + 1}</span>
                            <span className={isSelected ? 'text-emerald-300' : 'text-cyan-300'}>{isSelected ? 'Attached' : 'Attach'}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-700 p-3 text-xs leading-5 text-slate-400">
                    No automatic image choices were found on this page. Use the full page below and crop the exact diagram if this question needs one.
                  </div>
                )}
              </div>
            )}
            {canAttachImage && draft.source_image_url ? (
              <div className="rounded-lg border border-cyan-800 bg-cyan-950/30 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-cyan-300">{linkedImageFile ? `Question Image: ${linkedImageFile}` : `Textbook Page ${draft.source_page || ''}`}</span>
                  <a className="text-xs font-bold text-cyan-200 underline" href={apiAssetUrl(draft.source_image_url)} target="_blank" rel="noreferrer">Open image</a>
                </div>
                {cropMode ? (
                  <ReactCrop crop={cropSelection} onChange={(_, percentCrop) => setCropSelection(percentCrop)} aspect={undefined}>
                    <img src={apiAssetUrl(draft.source_image_url)} alt="Source page" className="max-h-[58vh] min-h-[360px] w-full rounded border border-cyan-900 object-contain bg-white" />
                  </ReactCrop>
                ) : (
                  <img src={apiAssetUrl(draft.source_image_url)} alt="Source page" className="max-h-[58vh] min-h-[360px] w-full rounded border border-cyan-900 object-contain bg-white" />
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-md border border-cyan-500/40 bg-cyan-900/40 px-3 py-2 text-xs font-bold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canCropCurrentImage} onClick={() => setCropMode((value) => !value)}>
                    <Crop className="mr-1 inline h-4 w-4" /> {cropMode ? 'Cancel Crop' : 'Crop Image'}
                  </button>
                  {cropMode && (
                    <button className="rounded-md bg-cyan-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40" disabled={savingCrop || !cropSelection?.width || !cropSelection?.height} onClick={saveCrop}>
                      {savingCrop ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Check className="mr-1 inline h-4 w-4" />} Attach Image to Question
                    </button>
                  )}
                </div>
                {!canCropCurrentImage && sourcePages.length > 0 && (
                  <div className="mt-2 rounded border border-amber-500/30 bg-amber-950/30 p-2 text-xs text-amber-100">
                    Select the original textbook page above to create a fresh manual crop.
                  </div>
                )}
                {cropError && <div className="mt-2 rounded border border-red-500/30 bg-red-950/40 p-2 text-xs text-red-200">{cropError}</div>}
              </div>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-700 px-6 text-center text-sm leading-6 text-slate-500">
                No cropped image is attached yet. Attach an image only when the question says to use a given diagram, graph, chart, or figure.
              </div>
            )}
            {canAttachImage && draft.source_excerpt && (
              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs leading-5 text-slate-300">
                <div className="mb-1 font-bold uppercase tracking-wide text-slate-500">Source Excerpt</div>
                {draft.source_excerpt}
              </div>
            )}
          </aside>
          )}

          <section className={`${visualWorkspace ? 'overflow-y-auto p-5' : 'mx-auto w-full max-w-6xl overflow-y-auto p-7'}`}>
            {!visualWorkspace && (
              <div className="mb-5 rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Review Mode</div>
                <div className="mt-1 text-sm font-semibold text-slate-200">Text question only. Image tools are hidden for this row.</div>
              </div>
            )}
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Question</label>
            <textarea className={`${visualWorkspace ? 'min-h-[220px]' : 'min-h-[280px]'} w-full rounded-lg border border-slate-700 bg-black/20 p-4 text-base leading-7 text-slate-100 outline-none focus:border-violet-500`} value={draft.question || ''} onChange={(e) => update('question', e.target.value)} />
            <label className="mb-2 mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">AI Answer</label>
            <textarea className={`${visualWorkspace ? 'min-h-[160px]' : 'min-h-[240px]'} w-full rounded-lg border border-slate-700 bg-black/20 p-4 text-sm leading-6 text-slate-100 outline-none focus:border-emerald-500`} value={draft['AI answer'] || ''} onChange={(e) => update('AI answer', e.target.value)} />
            <div className={`mt-5 grid grid-cols-1 gap-4 ${visualWorkspace ? 'xl:grid-cols-2' : 'md:grid-cols-3'}`}>
              {['question_type', 'bloom_tag', 'difficulty', 'lesson_no', 'lesson_name', 'subject_name'].map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{field}</label>
                  <input className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-violet-500" value={draft[field] || ''} onChange={(e) => update(field, e.target.value)} />
                </div>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button className="rounded-lg border border-violet-500/40 bg-violet-900/30 px-4 py-3 font-bold text-violet-100 hover:bg-violet-800/40" onClick={() => onRegenerate(index, draft)}>
                <RefreshCw className="mr-2 inline h-4 w-4" /> Regenerate
              </button>
              <button className="rounded-lg border border-amber-500/40 bg-amber-900/30 px-4 py-3 font-bold text-amber-200 hover:bg-amber-800/40" onClick={() => save('Needs Review')}>
                <AlertTriangle className="mr-2 inline h-4 w-4" /> Needs Review
              </button>
              <button className="rounded-lg border border-emerald-500/40 bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-500" onClick={() => save('Verified')}>
                <Check className="mr-2 inline h-4 w-4" /> Verify
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function QuestionCrafter() {
  const [savedDraft] = useState(() => loadQuestionCrafterDraft());
  const [files, setFiles] = useState([]);
  const [questionTypes, setQuestionTypes] = useState(savedDraft.questionTypes || ['objective', 'very_short', 'short', 'long', 'elaborative']);
  const [count, setCount] = useState(savedDraft.count || '30');
  const [difficulty, setDifficulty] = useState(savedDraft.difficulty || 'mixed');
  const [subjectName, setSubjectName] = useState(savedDraft.subjectName || 'English_302_new');
  const [lessonNo, setLessonNo] = useState(savedDraft.lessonNo || 'Lesson01');
  const [lessonName, setLessonName] = useState(savedDraft.lessonName || 'Full textbook');
  const [bloomTags, setBloomTags] = useState(savedDraft.bloomTags || ['knowledge', 'understanding', 'application']);
  const [includeAnswers] = useState(true);
  const [textbookSessionId, setTextbookSessionId] = useState(savedDraft.textbookSessionId || '');
  const [detectedLessons, setDetectedLessons] = useState(savedDraft.detectedLessons || []);
  const [analysisStats, setAnalysisStats] = useState(savedDraft.analysisStats || null);
  const [workbook, setWorkbook] = useState(savedDraft.workbook || {});
  const [generatedConfigs, setGeneratedConfigs] = useState(savedDraft.generatedConfigs || {});
  const [lessonSettings, setLessonSettings] = useState(savedDraft.lessonSettings || {});
  const [activeLesson, setActiveLesson] = useState(savedDraft.activeLesson || '');
  const [selectedLessonNos, setSelectedLessonNos] = useState(savedDraft.selectedLessonNos || []);
  const [analyzing, setAnalyzing] = useState(false);
  const [lessonGenerating, setLessonGenerating] = useState('');
  const [exporting, setExporting] = useState(false);
  const [answerGenerating, setAnswerGenerating] = useState(false);
  const [error, setError] = useState('');
  const [apiStatus, setApiStatus] = useState('checking');
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [wizardStep, setWizardStep] = useState(savedDraft.wizardStep || 'analyze');
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(null);
  const [cropReviewLessonNo, setCropReviewLessonNo] = useState(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  const effectiveCount = useMemo(() => Math.min(100, Math.max(1, Number.parseInt(count, 10) || 1)), [count]);

  const getLessonSettings = (lessonNoValue) => {
    const override = lessonSettings[lessonNoValue] || {};
    const typeList = override.questionTypes || questionTypes;
    const visualTypes = override.visualEnabled ? (override.visualTypes || []) : [];
    const mergedTypes = [...typeList.filter((item) => !['diagram', 'graph'].includes(item)), ...visualTypes];
    return {
      count: Math.min(100, Math.max(1, Number.parseInt(override.count ?? count, 10) || 1)),
      questionTypes: mergedTypes.length ? mergedTypes : questionTypes.filter((item) => !['diagram', 'graph'].includes(item)),
      difficulty: override.difficulty || difficulty,
      subjectName,
      bloomTags,
      includeAnswers: true,
      visualSourceEnabled: Boolean(override.visualEnabled && (override.visualTypes || []).length),
      approvedCropUrls: override.approvedCropUrls,
    };
  };
  const configKeyForLesson = (lessonNoValue) => JSON.stringify(getLessonSettings(lessonNoValue));
  const generationConfigKey = useMemo(() => JSON.stringify({
    count: effectiveCount,
    questionTypes,
    difficulty,
    subjectName,
    bloomTags,
    includeAnswers: true,
  }), [effectiveCount, questionTypes, difficulty, subjectName, bloomTags]);

  const lessonKeys = Object.keys(workbook);
  const selectedLessons = useMemo(
    () => detectedLessons.filter((lesson) => selectedLessonNos.includes(lesson.lesson_no)),
    [detectedLessons, selectedLessonNos],
  );
  const allDetectedSelected = detectedLessons.length > 0 && selectedLessons.length === detectedLessons.length;
  const activeRows = workbook[activeLesson] || [];
  const activeLessonMeta = detectedLessons.find((lesson) => lesson.lesson_no === activeLesson) || {};
  const cropReviewLesson = detectedLessons.find((lesson) => lesson.lesson_no === cropReviewLessonNo) || null;
  const activeSettingsStale = Boolean(activeLesson && workbook[activeLesson] && generatedConfigs[activeLesson] !== configKeyForLesson(activeLesson));
  const filteredRows = useMemo(() => activeRows.filter((row) => {
    const haystack = `${row.question || ''} ${row['AI answer'] || ''} ${row.question_type || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    const matchesVerify = !unverifiedOnly || row.review_status !== 'Verified';
    return matchesSearch && matchesVerify;
  }), [activeRows, search, unverifiedOnly]);

  const selectedLabel = useMemo(
    () => QUESTION_TYPES.filter((item) => questionTypes.includes(item.id)).map((item) => item.label).join(', '),
    [questionTypes],
  );
  const reviewItems = useMemo(() => Object.entries(workbook).flatMap(([lessonNoValue, rows]) => (
    (rows || []).map((row, index) => ({ lessonNo: lessonNoValue, row, index }))
  )), [workbook]);

  const totals = useMemo(() => {
    const rows = Object.values(workbook).flat();
    const progress = progressFor(rows);
    return { ...progress, issues: issueCountFor(rows, includeAnswers) };
  }, [workbook, includeAnswers]);
  const wizardSteps = [
    { id: 'analyze', label: 'Analyze', ready: Boolean(textbookSessionId) },
    { id: 'configure', label: 'Configure', ready: detectedLessons.length > 0 },
    { id: 'lessons', label: 'Lessons', ready: selectedLessons.length > 0 },
    { id: 'generate', label: 'Generate', ready: lessonKeys.length > 0 },
    { id: 'review', label: 'Review', ready: lessonKeys.length > 0 },
  ];

  useEffect(() => {
    saveQuestionCrafterDraft({
      questionTypes,
      count,
      difficulty,
      subjectName,
      lessonNo,
      lessonName,
      bloomTags,
      includeAnswers,
      textbookSessionId,
      detectedLessons,
      analysisStats,
      workbook,
      generatedConfigs,
      lessonSettings,
      activeLesson,
      selectedLessonNos,
      wizardStep,
    });
  }, [
    questionTypes,
    count,
    difficulty,
    subjectName,
    lessonNo,
    lessonName,
    bloomTags,
    includeAnswers,
    textbookSessionId,
    detectedLessons,
    analysisStats,
    workbook,
    generatedConfigs,
    lessonSettings,
    activeLesson,
    selectedLessonNos,
    wizardStep,
  ]);

  useEffect(() => {
    let active = true;
    const checkApi = async () => {
      try {
        const response = await qbankFetch(apiUrl('/gateway-health'), { cache: 'no-store' });
        if (!response.ok) throw new Error('Gateway offline');
        const data = await response.json();
        if (active) {
          setApiStatus('online');
          setGatewayStatus(data);
        }
      } catch {
        if (active) {
          setApiStatus('offline');
          setGatewayStatus(null);
        }
      }
    };
    checkApi();
    const timer = window.setInterval(checkApi, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const toggleType = (id) => setQuestionTypes((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleBloom = (id) => setBloomTags((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleLessonSelection = (lessonNoValue) => {
    setSelectedLessonNos((current) => (
      current.includes(lessonNoValue)
        ? current.filter((item) => item !== lessonNoValue)
        : [...current, lessonNoValue]
    ));
  };
  const setAllLessonsSelected = (checked) => {
    setSelectedLessonNos(checked ? detectedLessons.map((lesson) => lesson.lesson_no) : []);
  };

  const analyzeTextbook = async () => {
    setAnalyzing(true);
    setWorkbook({});
    setGeneratedConfigs({});
    setActiveLesson('');
    setDetectedLessons([]);
    setAnalysisStats(null);
    setTextbookSessionId('');
    setSelectedLessonNos([]);
    setError('');
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    formData.append('subject_name', subjectName);
    formData.append('fallback_lesson_no', lessonNo);
    formData.append('fallback_lesson_name', lessonName);

    try {
      const response = await qbankFetch(apiUrl('/detect-lessons'), { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Lesson detection failed');
      setTextbookSessionId(data.session_id || '');
      setDetectedLessons(data.lessons || []);
      setSelectedLessonNos((data.lessons || []).map((lesson) => lesson.lesson_no));
      setAnalysisStats(data.stats || null);
      setWizardStep('configure');
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const generateLesson = async (lesson) => {
    if (!textbookSessionId || !lesson?.lesson_no) return;
    const lessonConfig = getLessonSettings(lesson.lesson_no);
    if (lessonConfig.visualSourceEnabled && Array.isArray(lessonConfig.approvedCropUrls) && lessonConfig.approvedCropUrls.length === 0) {
      setError(`Approve at least one visual crop for ${lesson.lesson_no}, or turn off diagram/graph source.`);
      return false;
    }
    setLessonGenerating(lesson.lesson_no);
    setError('');
    try {
      const response = await qbankFetch(apiUrl('/generate-lesson'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: textbookSessionId,
          lesson_no: lesson.lesson_no,
          settings: {
            count: lessonConfig.count,
            question_types: lessonConfig.questionTypes,
            difficulty: lessonConfig.difficulty,
            subject_name: lessonConfig.subjectName,
            bloom_tags: lessonConfig.bloomTags,
            include_answers: true,
            visual_source_enabled: lessonConfig.visualSourceEnabled,
            approved_crop_urls: lessonConfig.approvedCropUrls,
            language: 'English',
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Question generation failed');
      const rows = (data.rows || []).map((row) => ({ ...polishRowText(row), review_status: row.review_status || 'Pending' }));
      setWorkbook((current) => ({ ...current, [lesson.lesson_no]: rows }));
      setGeneratedConfigs((current) => ({ ...current, [lesson.lesson_no]: JSON.stringify(lessonConfig) }));
      setActiveLesson(lesson.lesson_no);
      setWizardStep('review');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLessonGenerating('');
    }
  };

  const generateSelectedLessons = async () => {
    if (!textbookSessionId || selectedLessons.length === 0 || lessonGenerating) return;
    setError('');
    setWizardStep('generate');
    for (const lesson of selectedLessons) {
      const ok = await generateLesson(lesson);
      if (!ok) break;
    }
    setWizardStep('review');
  };

  const updateRow = (sheet, index, updates) => {
    setWorkbook((current) => ({
      ...current,
      [sheet]: current[sheet].map((row, rowIndex) => rowIndex === index ? { ...row, ...updates } : row),
    }));
  };

  const deleteRow = (sheet, index) => {
    setWorkbook((current) => ({
      ...current,
      [sheet]: current[sheet].filter((_, rowIndex) => rowIndex !== index).map((row, rowIndex) => ({ ...row, question_number: rowIndex + 1 })),
    }));
  };

  const generateMissingAnswers = async () => {
    if (!activeLesson || !textbookSessionId || answerGenerating) return false;
    const rows = workbook[activeLesson] || [];
    const missingCount = rows.filter((row) => !String(row['AI answer'] || '').trim()).length;
    if (!missingCount) return true;
    setAnswerGenerating(true);
    setError('');
    try {
      const lessonConfig = getLessonSettings(activeLesson);
      const response = await qbankFetch(apiUrl('/generate-missing-answers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: textbookSessionId,
          lesson_no: activeLesson,
          rows,
          settings: {
            question_types: lessonConfig.questionTypes,
            difficulty: lessonConfig.difficulty,
            subject_name: lessonConfig.subjectName,
            bloom_tags: lessonConfig.bloomTags,
            visual_source_enabled: lessonConfig.visualSourceEnabled,
            language: 'English',
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Answer generation failed');
      const answerMap = new Map((data.answers || []).map((item) => [Number(item.row_index), item['AI answer'] || '']));
      setWorkbook((current) => ({
        ...current,
        [activeLesson]: (current[activeLesson] || []).map((row, rowIndex) => {
          const answer = answerMap.get(rowIndex);
          return answer ? { ...row, 'AI answer': answer } : row;
        }),
      }));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setAnswerGenerating(false);
    }
  };

  const exportReviewed = async () => {
    setExporting(true);
    setError('');
    try {
      if (!activeLesson || !workbook[activeLesson]?.length) {
        throw new Error('Open a generated lesson before downloading.');
      }
      const warnings = [];
      if (activeSettingsStale) {
        warnings.push('The active lesson was generated with older settings.');
      }
      const missingAnswers = (workbook[activeLesson] || []).filter((row) => !String(row['AI answer'] || '').trim()).length;
      if (missingAnswers > 0) {
        warnings.push(`${missingAnswers} row(s) are missing answers. Use Generate Missing Answers before downloading.`);
      }
      const missingImages = (workbook[activeLesson] || []).filter((row) => needsGivenImage(row) && !imageFileName(row.source_image_url)).length;
      if (missingImages > 0) {
        warnings.push(`${missingImages} image-based row(s) are missing a question image.`);
      }
      if (warnings.length && !window.confirm(`${warnings.join('\n')}\n\nDownload anyway?`)) {
        return;
      }
      const workbookToExport = { [activeLesson]: workbook[activeLesson] || [] };
      const cleaned = Object.fromEntries(Object.entries(workbookToExport).map(([sheet, rows]) => [
        sheet,
        rows.map((row, rowIndex) => Object.fromEntries(COLUMNS.map((column) => {
          if (column === 'AI answer') return [column, row[column] || ''];
          if (column === 'bloom_tag') return [column, row[column] || bloomTags[rowIndex % Math.max(1, bloomTags.length)] || 'understanding'];
          if (column === 'difficulty') return [column, row[column] || difficulty || 'average'];
          return [column, row[column] || ''];
        }))),
      ]));
      const response = await qbankFetch(apiUrl('/export-reviewed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workbook: cleaned }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Export failed');
      const downloadResponse = await qbankFetch(`${apiUrl(data.download_url)}?t=${Date.now()}`);
      if (!downloadResponse.ok) throw new Error('Export was created, but the download failed.');
      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeLesson = activeLesson ? String(activeLesson).replace(/[^a-z0-9_-]+/gi, '_') : 'all_lessons';
      link.href = url;
      link.download = `reviewed_textbook_questions_${safeLesson}_${String(data.generation_id || Date.now()).slice(0, 8)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const applyFindReplace = () => {
    if (!findText) return;
    setWorkbook((current) => {
      const nextRows = (current[activeLesson] || []).map((row) => ({
        ...row,
        question: String(row.question || '').split(findText).join(replaceText),
        'AI answer': String(row['AI answer'] || '').split(findText).join(replaceText),
      }));
      return { ...current, [activeLesson]: nextRows };
    });
    setReplaceOpen(false);
    setFindText('');
    setReplaceText('');
  };

  const openReview = (realIndex) => setReviewIndex(realIndex);
  const saveReview = (index, row) => {
    updateRow(activeLesson, index, row);
    if (index < activeRows.length - 1) setReviewIndex(index + 1);
    else setReviewIndex(null);
  };

  const regenerateRow = async (index, row) => {
    if (!activeLesson || !textbookSessionId) return;
    setError('');
    try {
      const lessonConfig = getLessonSettings(activeLesson);
      const response = await qbankFetch(apiUrl('/regenerate-row'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: textbookSessionId,
          lesson_no: activeLesson,
          row,
          settings: {
            question_types: lessonConfig.questionTypes,
            difficulty: lessonConfig.difficulty,
            subject_name: lessonConfig.subjectName,
            bloom_tags: lessonConfig.bloomTags,
            include_answers: true,
            visual_source_enabled: lessonConfig.visualSourceEnabled,
            approved_crop_urls: lessonConfig.approvedCropUrls,
            language: 'English',
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Regeneration failed');
      updateRow(activeLesson, index, { ...polishRowText(data.row), question_number: row.question_number, review_status: data.row?.review_status || 'Pending' });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-5 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-600 p-2 text-white"><Brain className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">Textbook Question Crafter</h1>
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-600">Analyze - Generate - Verify - Export</p>
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 items-end gap-1 overflow-x-auto px-6 lg:flex">
          {lessonKeys.map((sheet) => {
            const progress = progressFor(workbook[sheet] || []);
            const issues = issueCountFor(workbook[sheet] || []);
            return (
              <button key={sheet} onClick={() => setActiveLesson(sheet)} className={`flex shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-bold ${activeLesson === sheet ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                <Database className="h-4 w-4" />
                {sheet}
                <ProgressRing pct={progress.pct} />
                {issues > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{issues}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className={`rounded-lg border px-3 py-2 text-xs font-black shadow-sm ${apiStatus === 'online' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : apiStatus === 'offline' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
            {apiStatus === 'checking' ? 'Checking' : apiStatus === 'online' ? `${gatewayStatus?.active_sessions || 0} users / ${gatewayStatus?.ports?.length || 0} ports` : 'Offline'}
          </div>
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50" onClick={() => { clearQuestionCrafterDraft(); window.location.reload(); }}><RefreshCw className="mr-1 inline h-4 w-4" /> Reset</button>
          <button disabled={!activeLesson || answerGenerating || !(workbook[activeLesson] || []).some((row) => !String(row['AI answer'] || '').trim())} onClick={generateMissingAnswers} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm disabled:opacity-40">
            {answerGenerating ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 inline h-4 w-4" />} Generate Missing Answers
          </button>
          <button disabled={!lessonKeys.length || exporting} onClick={exportReviewed} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-sm disabled:bg-slate-400">
            {exporting ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <Download className="mr-1 inline h-4 w-4" />} Download Reviewed Excel
          </button>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto">
          {wizardSteps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              onClick={() => setWizardStep(step.id)}
              className={`group flex min-w-[140px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all ${wizardStep === step.id ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${step.ready ? 'bg-emerald-500 text-white' : wizardStep === step.id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {step.ready ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span>
                <span className={`block text-sm font-black ${wizardStep === step.id ? 'text-violet-800' : 'text-slate-700'}`}>{step.label}</span>
                <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">{step.ready ? 'ready' : 'pending'}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <main className="grid flex-1 grid-cols-1 overflow-hidden bg-slate-100 lg:grid-cols-[420px_1fr]">
        <aside className="overflow-y-auto border-r border-slate-200 bg-white p-4">
          <div className="mb-4 rounded-xl border border-violet-100 bg-violet-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-violet-500">Current Step</div>
            <div className="mt-1 text-xl font-black text-slate-900">{wizardSteps.find((step) => step.id === wizardStep)?.label}</div>
          </div>

          {wizardStep === 'analyze' && (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h2 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Step 1 - Analyze Textbook</h2>
            {analysisStats && (
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-white p-2">
                  <div className="text-base font-black text-slate-800">{analysisStats.lessons || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">lessons</div>
                </div>
                <div className="rounded-md bg-white p-2">
                  <div className="text-base font-black text-cyan-700">{analysisStats.auto_crops || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">auto crops</div>
                </div>
                <div className="rounded-md bg-white p-2">
                  <div className="text-base font-black text-violet-700">{analysisStats.files_read || 0}</div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">files</div>
                </div>
              </div>
            )}
            <label className="flex min-h-[128px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-400 bg-white p-4 text-center hover:border-violet-400 hover:bg-violet-50">
              <UploadCloud className="h-8 w-8 text-violet-500" />
              <span className="font-bold">Upload PDF, DOCX, TXT or MD</span>
              <input className="hidden" type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(event) => {
                clearQuestionCrafterDraft();
                setFiles(Array.from(event.target.files || []));
                setDetectedLessons([]);
                setTextbookSessionId('');
                setAnalysisStats(null);
                setWorkbook({});
                setActiveLesson('');
                setSelectedLessonNos([]);
                setWizardStep('analyze');
              }} />
            </label>
            <div className="mt-3 max-h-28 space-y-2 overflow-y-auto">
              {files.map((file) => (
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold" key={file.name}>
                  <FileText className="h-4 w-4 text-slate-500" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
            </div>
          </section>
          )}

          {wizardStep === 'configure' && (
          <>
          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Step 2 - Question Controls</h2>
            <div className="grid grid-cols-2 gap-2">
              {QUESTION_TYPES.filter(({ id }) => !['diagram', 'graph'].includes(id)).map(({ id, label, icon: Icon }) => (
                <button key={id} className={`flex min-h-10 items-center justify-center gap-2 rounded-md border text-xs font-bold ${questionTypes.includes(id) ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-slate-300 bg-white text-slate-600'}`} onClick={() => toggleType(id)} type="button">
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-xs font-bold uppercase text-slate-500">Questions per lesson</label>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} onBlur={() => setCount(String(effectiveCount))} />
            <p className="mt-2 text-xs leading-5 text-slate-500">Set this before clicking a lesson. Each lesson can use a different count.</p>
            <label className="mt-4 block text-xs font-bold uppercase text-slate-500">Difficulty</label>
            <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="average">Average</option>
              <option value="difficult">Difficult</option>
            </select>
            <p className="mt-2 text-xs leading-5 text-slate-500">Mixed creates one combined set for the lesson, spread across easy, average, and difficult questions.</p>
            <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
              Answer key will be generated and exported.
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">Every generated lesson includes answers, so the review screen and Excel file do not end up with blank answer columns.</p>
          </section>

          <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Metadata</h2>
            <label className="block text-xs font-bold uppercase text-slate-500">Subject name</label>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />
            <label className="mt-3 block text-xs font-bold uppercase text-slate-500">Fallback lesson no</label>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={lessonNo} onChange={(e) => setLessonNo(e.target.value)} />
            <label className="mt-3 block text-xs font-bold uppercase text-slate-500">Fallback lesson name</label>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={lessonName} onChange={(e) => setLessonName(e.target.value)} />
            <label className="mt-3 block text-xs font-bold uppercase text-slate-500">Bloom tags</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {BLOOM_TAGS.map((tag) => (
                <button key={tag} className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${bloomTags.includes(tag) ? 'border-violet-600 bg-violet-50 text-violet-700' : 'border-slate-300 text-slate-600'}`} type="button" onClick={() => toggleBloom(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </section>

          <button className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 font-bold text-white shadow-md disabled:bg-slate-400" disabled={!detectedLessons.length} onClick={() => setWizardStep('lessons')} type="button">
            Continue to lesson selection
          </button>
          </>
          )}

          {wizardStep === 'analyze' && (
          <button className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 font-bold text-white shadow-md disabled:bg-slate-400" disabled={!files.length || analyzing} onClick={analyzeTextbook} type="button">
            {analyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookOpen className="h-5 w-5" />} Analyze Textbook
          </button>
          )}

          {wizardStep === 'lessons' && detectedLessons.length > 0 && (
            <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Step 3 - Select Lessons</h2>
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{detectedLessons.length}</span>
              </div>
              <div className="mb-3 rounded-lg border border-violet-100 bg-violet-50 p-3">
                <label className="flex items-center gap-2 text-xs font-bold text-violet-800">
                  <input
                    type="checkbox"
                    checked={allDetectedSelected}
                    onChange={(event) => setAllLessonsSelected(event.target.checked)}
                  />
                  Select all lessons
                </label>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="flex min-h-9 flex-1 items-center justify-center gap-2 rounded-md bg-violet-600 px-3 text-xs font-bold text-white shadow-sm disabled:bg-slate-400"
                    type="button"
                    disabled={!selectedLessons.length || Boolean(lessonGenerating)}
                    onClick={generateSelectedLessons}
                  >
                    {lessonGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                    Generate selected
                  </button>
                  <span className="shrink-0 rounded-md bg-white px-2.5 py-2 text-xs font-black text-violet-700">
                    {selectedLessons.length}/{detectedLessons.length}
                  </span>
                </div>
              </div>
              <div className="max-h-[calc(100vh-360px)] min-h-[520px] space-y-2 overflow-y-auto pr-1">
                {detectedLessons.map((lesson) => {
                  const isGenerated = Boolean(workbook[lesson.lesson_no]);
                  const isSelected = selectedLessonNos.includes(lesson.lesson_no);
                  const lessonConfig = getLessonSettings(lesson.lesson_no);
                  const lessonConfigKey = JSON.stringify(lessonConfig);
                  const isCurrentSettings = generatedConfigs[lesson.lesson_no] === lessonConfigKey;
                  const needsRegenerate = isGenerated && !isCurrentSettings;
                  const isGenerating = lessonGenerating === lesson.lesson_no;
                  const progress = progressFor(workbook[lesson.lesson_no] || []);
                  const hasVisualSource = Number(lesson.auto_crop_count || 0) > 0;
                  const lessonCropUrls = (lesson.source_pages || []).flatMap((page) => page.crops || []);
                  const approvedCropUrls = lessonSettings[lesson.lesson_no]?.approvedCropUrls;
                  const approvedCropCount = approvedCropUrls ? approvedCropUrls.length : lessonCropUrls.length;
                  const toggleLessonType = (typeId) => {
                    setLessonSettings((current) => {
                      const existing = current[lesson.lesson_no] || {};
                      const baseTypes = existing.visualTypes || [];
                      const nextTypes = baseTypes.includes(typeId) ? baseTypes.filter((item) => item !== typeId) : [...baseTypes, typeId];
                      return { ...current, [lesson.lesson_no]: { ...existing, visualEnabled: true, visualTypes: nextTypes } };
                    });
                  };
                  return (
                    <div
                      key={lesson.lesson_no}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${activeLesson === lesson.lesson_no ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-white'}`}
                      onClick={() => setActiveLesson(lesson.lesson_no)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <input
                              className="mt-0.5 h-4 w-4 shrink-0"
                              type="checkbox"
                              checked={isSelected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleLessonSelection(lesson.lesson_no)}
                            />
                            <div className="min-w-0">
                              <div className="font-mono text-xs font-black text-violet-700">{lesson.lesson_no}</div>
                              <div className="mt-0.5 truncate text-sm font-bold text-slate-800">{lesson.lesson_name}</div>
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{lesson.word_count || 0} words</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {hasVisualSource && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-700">{lesson.auto_crop_count} possible image(s)</span>}
                            {hasVisualSource && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{approvedCropCount} approved</span>}
                            {!hasVisualSource && lesson.diagram_available && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">visual words found, no crop</span>}
                            {lesson.diagram_pages?.length > 0 && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">pages {lesson.diagram_pages.slice(0, 3).join(', ')}</span>}
                          </div>
                          <div className="mt-3 grid grid-cols-[76px_1fr] gap-2" onClick={(event) => event.stopPropagation()}>
                            <input
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold"
                              type="number"
                              min="1"
                              max="100"
                              value={lessonSettings[lesson.lesson_no]?.count ?? count}
                              onChange={(event) => setLessonSettings((current) => ({
                                ...current,
                                [lesson.lesson_no]: { ...(current[lesson.lesson_no] || {}), count: event.target.value },
                              }))}
                            />
                            <div>
                              {hasVisualSource ? (
                                <>
                                  <button
                                    className="mb-2 rounded-md border border-cyan-200 bg-white px-2.5 py-1.5 text-[10px] font-black text-cyan-700 hover:bg-cyan-50"
                                    type="button"
                                    onClick={() => setCropReviewLessonNo(lesson.lesson_no)}
                                  >
                                    View crops
                                  </button>
                                  <label className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-700">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(lessonSettings[lesson.lesson_no]?.visualEnabled)}
                                      onChange={(event) => setLessonSettings((current) => ({
                                        ...current,
                                        [lesson.lesson_no]: {
                                          ...(current[lesson.lesson_no] || {}),
                                          visualEnabled: event.target.checked,
                                          visualTypes: event.target.checked ? (current[lesson.lesson_no]?.visualTypes || ['diagram']) : [],
                                        },
                                      }))}
                                    />
                                    use diagram/graph source
                                  </label>
                                  {lessonSettings[lesson.lesson_no]?.visualEnabled && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {['diagram', 'graph'].map((typeId) => (
                                        <button
                                          key={typeId}
                                          type="button"
                                          className={`rounded border px-2 py-1 text-[10px] font-bold ${(lessonSettings[lesson.lesson_no]?.visualTypes || []).includes(typeId) ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-300 bg-white text-slate-500'}`}
                                          onClick={() => toggleLessonType(typeId)}
                                        >
                                          {typeId}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {lessonSettings[lesson.lesson_no]?.visualEnabled && approvedCropCount === 0 && (
                                    <div className="mt-1 text-[10px] font-bold text-red-600">No approved images. Open crops and approve at least one.</div>
                                  )}
                                </>
                              ) : (
                                <span className="text-[10px] font-bold text-slate-400">no visual crop found</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {isGenerating ? (
                            <Loader2 className="ml-auto h-5 w-5 animate-spin text-violet-600" />
                          ) : needsRegenerate ? (
                            <>
                              <button
                                className="rounded-full bg-amber-600 px-3 py-1.5 text-[10px] font-bold text-white"
                                type="button"
                                disabled={Boolean(lessonGenerating)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  generateLesson(lesson);
                                }}
                              >
                                Regenerate {lessonConfig.count}
                              </button>
                              <div className="mt-1 text-[10px] font-bold text-amber-600">settings changed</div>
                            </>
                          ) : isGenerated ? (
                            <>
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">Generated</span>
                              <div className="mt-1 text-[10px] font-bold text-slate-400">{progress.verified}/{progress.total} verified</div>
                            </>
                          ) : (
                            <button
                              className="rounded-full bg-violet-600 px-3 py-1.5 text-[10px] font-bold text-white"
                              type="button"
                              disabled={Boolean(lessonGenerating)}
                              onClick={(event) => {
                                event.stopPropagation();
                                generateLesson(lesson);
                              }}
                            >
                              Generate {lessonConfig.count}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {wizardStep === 'generate' && (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Generate Queue</h2>
              <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-bold text-slate-900">{selectedLessons.length} lesson(s) selected</div>
                <div className="mt-1">Each lesson will appear as a tab immediately after it finishes.</div>
              </div>
              <button
                className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 font-bold text-white shadow-md disabled:bg-slate-400"
                type="button"
                disabled={!selectedLessons.length || Boolean(lessonGenerating)}
                onClick={generateSelectedLessons}
              >
                {lessonGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookOpen className="h-5 w-5" />}
                {lessonGenerating ? `Generating ${lessonGenerating}` : 'Generate selected lessons'}
              </button>
            </section>
          )}

          {wizardStep === 'review' && (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Review Workspace</h2>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-xl font-black text-slate-900">{totals.total}</div>
                  <div className="text-[10px] font-bold uppercase text-slate-400">generated</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center">
                  <div className="text-xl font-black text-emerald-600">{totals.verified}</div>
                  <div className="text-[10px] font-bold uppercase text-emerald-500">verified</div>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 text-center">
                  <div className="text-xl font-black text-amber-600">{totals.issues}</div>
                  <div className="text-[10px] font-bold uppercase text-amber-500">issues</div>
                </div>
              </div>
              <button className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-40" disabled={!activeLesson} onClick={() => setDrawerOpen(true)}>
                <ShieldCheck className="mr-2 inline h-4 w-4" /> Open verification queue
              </button>
            </section>
          )}
          {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        </aside>

        <section className="flex min-w-0 flex-col overflow-hidden p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-5">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Generated</div>
                <div className="text-xl font-black text-slate-800">{totals.total}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Verified</div>
                <div className="text-xl font-black text-emerald-600">{totals.verified}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Issues</div>
                <div className="text-xl font-black text-amber-600">{totals.issues}</div>
              </div>
              <div className="hidden text-sm text-slate-500 xl:block">{selectedLabel || 'Select question types'}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
                <button onClick={() => setViewMode('list')} className={`rounded px-3 py-1.5 text-xs font-bold ${viewMode === 'list' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><List className="mr-1 inline h-3.5 w-3.5" /> List</button>
                <button onClick={() => setViewMode('grid')} className={`rounded px-3 py-1.5 text-xs font-bold ${viewMode === 'grid' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}><Columns className="mr-1 inline h-3.5 w-3.5" /> Grid</button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input className="w-56 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" placeholder="Search questions" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button onClick={() => setUnverifiedOnly((v) => !v)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${unverifiedOnly ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-300 bg-white text-slate-600'}`}><Filter className="mr-1 inline h-4 w-4" /> Unverified</button>
              <button disabled={!activeLesson} onClick={() => setReplaceOpen(true)} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40"><Replace className="mr-1 inline h-4 w-4" /> Find & Replace</button>
              <button disabled={!lessonKeys.length} onClick={() => setDrawerOpen(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"><ShieldCheck className="mr-1 inline h-4 w-4" /> Review Queue</button>
            </div>
          </div>

          {activeSettingsStale && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span className="font-semibold">These rows were generated with older question settings.</span>
              <button
                className="rounded-md bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
                type="button"
                disabled={Boolean(lessonGenerating)}
                onClick={() => {
                  const lesson = detectedLessons.find((item) => item.lesson_no === activeLesson);
                  if (lesson) generateLesson(lesson);
                }}
              >
                Regenerate with selected types
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {!lessonKeys.length ? (
              <div className="flex h-full min-h-[560px] flex-col items-center justify-center gap-3 text-center text-slate-500">
                <BookOpen className="h-12 w-12 text-slate-400" />
                <p className="font-semibold">Upload and analyze a textbook, then select one lesson to generate 30 mixed questions.</p>
                {detectedLessons.length > 0 && <p className="text-sm">Detected lessons are ready in the left panel.</p>}
              </div>
            ) : viewMode === 'list' ? (
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500 shadow-sm">
                  <tr>
                    <th className="w-16 px-4 py-3">No</th>
                    <th className="w-32 px-4 py-3">Type</th>
                    <th className="px-4 py-3">Question</th>
                    <th className="w-36 px-4 py-3">Status</th>
                    <th className="w-36 px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const realIndex = activeRows.indexOf(row);
                    const status = rowStatus(row, includeAnswers);
                    const statusClass = {
                      emerald: 'bg-emerald-100 text-emerald-700',
                      amber: 'bg-amber-100 text-amber-700',
                      cyan: 'bg-cyan-100 text-cyan-700',
                      slate: 'bg-slate-100 text-slate-500',
                    }[status.tone] || 'bg-slate-100 text-slate-500';
                    return (
                      <tr className={`border-t border-slate-100 align-top hover:bg-violet-50/40 ${row.review_status === 'Verified' ? 'bg-emerald-50/30' : row.review_status === 'Needs Review' ? 'bg-amber-50/50' : ''}`} key={`${row.lesson_no}-${row.question_number}-${realIndex}`}>
                        <td className="px-4 py-4 font-mono font-bold text-slate-500">{row.question_number}</td>
                        <td className="px-4 py-4 font-semibold text-slate-700">{row.question_type}</td>
                        <td className="px-4 py-4">
                          <div className="line-clamp-2 font-medium text-slate-800">{row.question}</div>
                          {includeAnswers && <div className="mt-1 line-clamp-1 text-xs text-slate-500">{row['AI answer']}</div>}
                          {isVisualRow(row) && (row.source_page || row.source_image_url) && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-cyan-700">
                              {row.source_page && <span className="rounded bg-cyan-50 px-2 py-0.5 font-bold">Page {row.source_page}</span>}
                              {imageFileName(row.source_image_url)
                                ? <a className="font-bold underline" href={apiAssetUrl(row.source_image_url)} target="_blank" rel="noreferrer">question image</a>
                                : <span className="font-bold text-amber-700">crop needed</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass}`}>{status.label}</span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button className="mr-2 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={() => openReview(realIndex)}><Eye className="mr-1 inline h-4 w-4" /> Review</button>
                          <button className="rounded-md border border-red-200 px-2 py-1.5 text-red-600 hover:bg-red-50" onClick={() => deleteRow(activeLesson, realIndex)}><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase text-slate-500 shadow-sm">
                  <tr>{[...COLUMNS, 'review_status'].map((column) => <th className="border-r border-slate-200 px-3 py-3" key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const realIndex = activeRows.indexOf(row);
                    return (
                      <tr className="border-t border-slate-100 hover:bg-violet-50/30" key={`${row.lesson_no}-${row.question_number}-${realIndex}`}>
                        {[...COLUMNS, 'review_status'].map((column) => (
                          <td className="max-w-[420px] border-r border-slate-100 px-3 py-2 align-top" key={column}>
                            <textarea className="min-h-12 w-full resize-y rounded border border-transparent bg-transparent p-1 outline-none focus:border-violet-400 focus:bg-white" value={row[column] || ''} onChange={(e) => updateRow(activeLesson, realIndex, { [column]: e.target.value })} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      <CropGalleryModal
        lesson={cropReviewLesson}
        approvedUrls={cropReviewLesson ? lessonSettings[cropReviewLesson.lesson_no]?.approvedCropUrls : null}
        onChange={(approvedCropUrls) => {
          if (!cropReviewLesson) return;
          setLessonSettings((current) => ({
            ...current,
            [cropReviewLesson.lesson_no]: {
              ...(current[cropReviewLesson.lesson_no] || {}),
              approvedCropUrls,
            },
          }));
        }}
        onClose={() => setCropReviewLessonNo(null)}
      />
      <VerifyDrawer
        open={drawerOpen}
        reviewItems={reviewItems}
        requireAnswers={includeAnswers}
        onClose={() => setDrawerOpen(false)}
        onOpenRow={(lessonNoValue, index) => {
          setActiveLesson(lessonNoValue);
          setDrawerOpen(false);
          openReview(index);
        }}
      />
      <ReviewModal open={reviewIndex !== null} rows={activeRows} index={reviewIndex ?? 0} sessionId={textbookSessionId} sourcePages={activeLessonMeta.source_pages || []} onClose={() => setReviewIndex(null)} onSave={saveReview} onNavigate={setReviewIndex} onRegenerate={regenerateRow} />

      {replaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold text-slate-800"><Replace className="h-5 w-5 text-violet-600" /> Find & Replace</h2>
              <button className="rounded-md p-2 text-slate-400 hover:bg-slate-100" onClick={() => setReplaceOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <label className="block text-xs font-bold uppercase text-slate-500">Find</label>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={findText} onChange={(e) => setFindText(e.target.value)} />
            <label className="mt-4 block text-xs font-bold uppercase text-slate-500">Replace with</label>
            <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-md px-4 py-2 font-bold text-slate-500 hover:bg-slate-100" onClick={() => setReplaceOpen(false)}>Cancel</button>
              <button className="rounded-md bg-violet-600 px-5 py-2 font-bold text-white disabled:opacity-40" disabled={!findText} onClick={applyFindReplace}>Replace All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
