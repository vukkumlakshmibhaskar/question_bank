import React, { useState, useEffect, useRef } from 'react';
import { toPng, toJpeg } from 'html-to-image';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { 
  ArrowLeft, Plus, Image as ImageIcon, Save, Loader2, Upload, Pencil, AlertTriangle, X 
} from 'lucide-react';

const CANVAS_API = "http://172.16.10.19:8019"; 

// --- INTERNAL BLOCK COMPONENT ---
const Block = ({ data, isSelected, onSelect, onChange, onPositionChange, paperWidth, paperHeight }) => {
  const [isEditing, setIsEditing] = useState(false);
  const mathContainerRef = useRef(null);
  
  const left = (data.x_rel / 1000) * paperWidth;
  const top = (data.y_rel / 1000) * paperHeight;

  const handleMouseDown = (e) => {
    if (isEditing || e.button !== 0) return;
    e.stopPropagation();
    onSelect();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialRelX = data.x_rel;
    const initialRelY = data.y_rel;

    const handleMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const relDx = (dx / paperWidth) * 1000;
      const relDy = (dy / paperHeight) * 1000;
      onPositionChange(data.id, initialRelX + relDx, initialRelY + relDy);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    if (!isEditing && mathContainerRef.current) {
        try {
            if(data.type === 'math' || data.text.includes('\\')) {
                katex.render(data.text, mathContainerRef.current, { throwOnError: false, displayMode: true });
            } else {
                mathContainerRef.current.innerText = data.text;
            }
        } catch(e) {
            mathContainerRef.current.innerText = data.text;
        }
    }
  }, [data.text, isEditing, data.type]);

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
      className={`absolute p-2 transition-all group ${isSelected ? 'z-50' : 'z-10'}`}
      style={{ left, top, cursor: isEditing ? 'text' : 'grab' }}
    >
      <div className={`absolute inset-0 rounded-lg pointer-events-none transition-all ${isSelected ? 'border-2 border-blue-500 bg-blue-50/20' : 'border border-transparent group-hover:border-slate-300'}`} />
      
      {isSelected && !isEditing && (
         <div className="absolute -top-6 left-0 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded shadow-sm font-bold uppercase tracking-wider">Drag</div>
      )}

      {isEditing ? (
        <textarea
          autoFocus value={data.text} onChange={(e) => onChange(e.target.value)} onBlur={() => setIsEditing(false)} onMouseDown={(e) => e.stopPropagation()} 
          className="relative z-50 min-w-[200px] min-h-[60px] p-2 bg-white border-2 border-blue-400 rounded-lg shadow-xl focus:outline-none font-mono text-sm text-slate-700"
        />
      ) : (
        <div ref={mathContainerRef} className="relative z-20 text-slate-800 text-lg font-medium pointer-events-none select-none" />
      )}
    </div>
  );
};

// --- MAIN CANVAS COMPONENT ---
const Canvas = ({ onBack }) => {
  const [paperSize, setPaperSize] = useState('A4');
  const [blocks, setBlocks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showExitWarning, setShowExitWarning] = useState(false); // <--- NEW SAFETY STATE
  const paperRef = useRef(null);

  const paperConfig = {
    A4: { name: 'A4', width: 794, height: 1123 },
    Letter: { name: 'Letter', width: 816, height: 1056 },
    Legal: { name: 'Legal', width: 816, height: 1344 },
    Infinite: { name: 'Infinite', width: 1200, height: 1500 }
  };
  const currentDim = paperConfig[paperSize];

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedId) return;
      if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;
      
      const step = e.shiftKey ? 20 : 5;
      setBlocks(prev => prev.map(b => {
        if (b.id !== selectedId) return b;
        switch(e.key) {
          case 'ArrowUp': return { ...b, y_rel: b.y_rel - step };
          case 'ArrowDown': return { ...b, y_rel: b.y_rel + step };
          case 'ArrowLeft': return { ...b, x_rel: b.x_rel - step };
          case 'ArrowRight': return { ...b, x_rel: b.x_rel + step };
          case 'Delete': case 'Backspace': return null; 
          default: return b;
        }
      }).filter(Boolean)); 
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${CANVAS_API}/extract`, { method: 'POST', body: formData });
      const data = await response.json();
      const newBlocks = data.blocks.map(b => ({
        ...b,
        x_rel: b.x_rel || b.box?.x || 0,
        y_rel: b.y_rel || b.box?.y || 0
      }));
      setBlocks(newBlocks);
    } catch (error) {
      alert("Error connecting to Python backend. Is it running on port 8000?");
    } finally {
      setLoading(false);
    }
  };

  const addTextManually = () => {
    const newBlock = { id: Date.now().toString(), text: "New Note", x_rel: 100, y_rel: 100, type: "text" };
    setBlocks([...blocks, newBlock]);
    setSelectedId(newBlock.id);
  };

  const downloadImage = (format) => {
    if (!paperRef.current) return;
    setSelectedId(null);
    const func = format === 'png' ? toPng : toJpeg;
    setTimeout(() => {
        func(paperRef.current, { cacheBust: true, backgroundColor: 'white' })
        .then((url) => {
            const link = document.createElement('a');
            link.download = `math-notes.${format}`;
            link.href = url;
            link.click();
        });
    }, 100);
  };

  // --- SAFETY HANDLER ---
  const handleBackClick = () => {
    if (blocks.length > 0) {
        setShowExitWarning(true); // Show popup if there is work
    } else {
        onBack(); // Go back immediately if canvas is empty
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-200 animate-in fade-in duration-300 fixed inset-0 z-50">
      
      {/* EXIT WARNING MODAL */}
      {showExitWarning && (
        <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in duration-200">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="bg-amber-100 p-3 rounded-full text-amber-600">
                        <AlertTriangle size={32} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800">Unsaved Changes</h3>
                        <p className="text-slate-500 text-sm mt-1">If you leave now, your canvas work will be lost forever.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 w-full mt-2">
                        <button onClick={() => setShowExitWarning(false)} className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-lg hover:bg-slate-200">
                            Stay
                        </button>
                        <button onClick={onBack} className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700">
                            Discard & Leave
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border-b border-slate-300 px-6 py-3 flex items-center justify-between shadow-sm flex-none z-40">
        <div className="flex items-center gap-4">
            {/* UPDATED BACK BUTTON */}
            <button onClick={handleBackClick} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors">
                <ArrowLeft size={16}/> Back to DSR
            </button>
            <div className="h-6 w-px bg-slate-300"></div>
            <h2 className="font-bold text-slate-700 flex items-center gap-2"><Pencil size={18} className="text-blue-600"/> Canvas Editor</h2>
        </div>

        <div className="flex items-center gap-3">
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                {Object.keys(paperConfig).map(size => (
                    <button key={size} onClick={() => setPaperSize(size)} 
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${paperSize === size ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        {size}
                    </button>
                ))}
            </div>
            
            <button onClick={addTextManually} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 shadow-sm transition-all">
                <Plus size={16}/> Add Text
            </button>

            <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 shadow-sm transition-all cursor-pointer">
                <ImageIcon size={16}/> Upload Image
                <input type="file" hidden onChange={handleFileUpload} accept="image/*" />
            </label>

            <button onClick={() => downloadImage('png')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow-md transition-all">
                <Save size={16}/> Export
            </button>
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 overflow-auto p-10 flex justify-center custom-scrollbar relative" onClick={() => setSelectedId(null)}>
        <div 
            ref={paperRef}
            className="bg-white shadow-2xl relative transition-all duration-300"
            style={{ width: currentDim.width, height: currentDim.height }}
        >
            {loading && (
                <div className="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
                    <Loader2 size={40} className="text-blue-600 animate-spin mb-4"/>
                    <p className="text-slate-600 font-bold">Scanning with Gemini...</p>
                </div>
            )}
            
            {!loading && blocks.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
                    <div className="h-32 w-32 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                        <Upload size={40} className="text-slate-400"/>
                    </div>
                    <p className="text-slate-500 font-medium">Upload Math Image or Add Text</p>
                </div>
            )}

            {blocks.map((block) => (
                <Block 
                    key={block.id} 
                    data={block} 
                    isSelected={selectedId === block.id}
                    onSelect={() => setSelectedId(block.id)}
                    onChange={(txt) => setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, text: txt } : b))}
                    onPositionChange={(id, x, y) => setBlocks(prev => prev.map(b => b.id === id ? { ...b, x_rel: x, y_rel: y } : b))}
                    paperWidth={currentDim.width}
                    paperHeight={currentDim.height}
                />
            ))}
        </div>
      </div>
    </div>
  );
};

export default Canvas;  