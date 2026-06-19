import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Login from './login';
import { 
  Shield, Upload, FileSpreadsheet, Play, StopCircle, 
  Download, Trash2, X, Bot, Loader2, FileText, Send, Eye,
  CheckCircle // NEW: Added CheckCircle icon for visual feedback
} from 'lucide-react';

const API_BASE = "http://172.16.10.19:8018"; // YOUR SERVER IP

const App = () => {

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [status, setStatus] = useState("idle"); 
  const [files, setFiles] = useState([]); 
  const [logs, setLogs] = useState([]);
  const [extractedData, setExtractedData] = useState([]);
  const [progress, setProgress] = useState(0); 
  const logEndRef = useRef(null);
  const [chatInput, setChatInput] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [logoError, setLogoError] = useState(false);

  // NEW: Track which files have successfully finished processing
  const [processedFileNames, setProcessedFileNames] = useState([]);

  // --- LOGIC ---
  useEffect(() => {
    if (!isAuthenticated) return;

    let eventSource;
    if (status === "processing") {
      eventSource = new EventSource(`${API_BASE}/logs`);
      eventSource.onmessage = (e) => {
        try {
            const parsed = JSON.parse(e.data);
            setLogs(prev => [...prev, parsed]);
            if (parsed.text.includes("Reading")) setProgress(prev => Math.min(prev + 5, 90));
            if (parsed.text.includes("extracted")) setProgress(prev => Math.min(prev + 10, 95));
        } catch (err) {
            setLogs(prev => [...prev, { type: 'info', text: e.data }]);
        }
      };
      eventSource.onerror = () => eventSource.close();
    }
    return () => { if (eventSource) eventSource.close(); };
  }, [status, isAuthenticated]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleStart = async () => {
    // 1. Filter for valid Docx files
    const allDocFiles = files.filter(f => f.name.endsWith('.docx') || f.name.endsWith('.doc'));
    
    // Filter out files that are ALREADY in our 'processedFileNames' list
    const filesToSend = allDocFiles.filter(f => !processedFileNames.includes(f.name));
    
    const templateFile = files.find(f => f.name.endsWith('.xlsx') || f.name.endsWith('.csv'));

    if (allDocFiles.length === 0) return alert("Please upload at least one DSR Document (.docx)");
    
    // Alert if there are no *new* files to process
    if (filesToSend.length === 0) {
        return alert("All listed files have already been processed! Add a new file to run extraction.");
    }

    setStatus("processing");
    
    // Append logs instead of replacing them, so we keep history
    let newLogs = [{ type: 'system', text: `Starting extraction for ${filesToSend.length} new file(s)...` }];
    
    if (templateFile) {
        newLogs.push({ type: 'success', text: `Using Template: ${templateFile.name}` });
    } else {
        newLogs.push({ type: 'info', text: "No template found. Using Master DSR Format." });
    }

    if (customInstructions) {
        newLogs.push({ type: 'info', text: `Applying Rule: "${customInstructions}"` });
    }
    
    //  Keep old logs, add new ones
    setLogs(prev => [...prev, ...newLogs]); 
    
    // keep the old rows!
    setProgress(5);

    try {
      const formData = new FormData();
      // NEW: Only append the files we filtered (filesToSend), not all files
      filesToSend.forEach(f => formData.append('files', f));
      
      if (templateFile) formData.append('template_file', templateFile);
      
      formData.append('custom_instruction', customInstructions);

      const res = await axios.post(`${API_BASE}/process-documents`, formData);

      if (res.data && res.data.length > 0) {
        // MERGE data! Add new rows to existing extractedData
        setExtractedData(prev => [...prev, ...res.data]);
        
        // Mark these files as processed so we don't send them again
        const newlyProcessedNames = filesToSend.map(f => f.name);
        setProcessedFileNames(prev => [...prev, ...newlyProcessedNames]);

        setStatus("complete");
        setProgress(100);
        setLogs(prev => [...prev, { type: 'success', text: `Success! Added ${res.data.length} new records.` }]);
      } else {
        setStatus("idle");
        setProgress(0);
        setLogs(prev => [...prev, { type: 'error', text: "No data found in the new files." }]);
      }
    } catch (error) {
      setLogs(prev => [...prev, { type: 'error', text: `System Error: ${error.message}` }]);
      setStatus("idle");
    }
  };

  const handleStop = async () => {
    setStatus("idle");
    setLogs(prev => [...prev, { type: 'error', text: "🛑 Process stopped by user." }]);
    setProgress(0);
    try { await axios.post(`${API_BASE}/stop`); } catch (e) {}
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput("");
    setLogs(prev => [...prev, { type: 'user', text: userMsg }]);

    if (extractedData.length > 0 && status === "complete") {
        setLogs(prev => [...prev, { type: 'system', text: "Processing your request..." }]);
        try {
            const res = await axios.post(`${API_BASE}/refine-data`, {
                current_data: extractedData, instruction: userMsg
            });
            if (res.data.updated_data) setExtractedData(res.data.updated_data);
            const reply = res.data.response_text || "Data updated successfully.";
            setLogs(prev => [...prev, { type: 'success', text: reply }]);
        } catch (err) {
            setLogs(prev => [...prev, { type: 'error', text: "Refine Failed: " + err.message }]);
        }
    } else {
        setCustomInstructions(userMsg);
        setLogs(prev => [...prev, { type: 'info', text: "Got it. I will apply this instruction during extraction." }]);
    }
  };

  const downloadExcel = async () => {
    try {
      const formData = new FormData();
      formData.append('data_str', JSON.stringify(extractedData));
      const res = await axios.post(`${API_BASE}/generate-excel`, formData, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `DSR_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) { alert("Error generating Excel."); }
  };

  // --- RENDER ---
  if (!isAuthenticated) {
    return <Login onLogin={setIsAuthenticated} />;
  }

  return (
    <div className="h-screen w-screen bg-slate-200 font-sans text-slate-800 flex flex-col overflow-hidden relative">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>

      {/* VERIFICATION MODAL */}
      {showPreview && (
        <div className="absolute inset-0 z-[100] bg-slate-900/95 flex items-center justify-center p-4 lg:p-10 backdrop-blur-sm">
            <div className="bg-white w-full h-full rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 border border-slate-700">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-none">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <FileSpreadsheet size={20} className="text-green-600"/> Data Preview ({extractedData.length} Records)
                    </h3>
                    <button onClick={() => setShowPreview(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={24} className="text-slate-500"/></button>
                </div>
                <div className="flex-1 overflow-auto p-0 custom-scrollbar">
                    <table className="w-full text-xs text-left border-collapse">
                        <thead className="sticky top-0 z-10 shadow-sm">
                            <tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
                                {extractedData.length > 0 && Object.keys(extractedData[0]).map((key) => (
                                    <th key={key} className="p-3 font-bold whitespace-nowrap border-r border-slate-200">{key}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {extractedData.map((row, i) => (
                                <tr key={i} className="border-b border-slate-100 hover:bg-blue-50 transition-colors">
                                    {Object.values(row).map((val, idx) => (
                                        <td key={idx} className="p-3 max-w-[250px] truncate border-r border-slate-100">{String(val)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3 flex-none">
                    <button onClick={() => setShowPreview(false)} className="px-5 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Close Preview</button>
                    <button onClick={downloadExcel} className="px-6 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 shadow-lg flex items-center gap-2 transition-transform active:scale-95"><Download size={18}/> Download Excel</button>
                </div>
            </div>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-slate-900 shadow-md border-b border-slate-700 flex-none z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className=" w-25 h-20 rounded-lg overflow-hidden">
                {!logoError ? (
                    <img src="/DSR_Logo.png" alt="Logo" className="h-full w-full object-contain" onError={() => setLogoError(true)} />
                ) : (
                    <Shield size={22} className="text-blue-600" />
                )}
            </div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight">imove4m</h1>
          </div>
          <div className={`px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider border shadow-sm ${status === 'processing' ? 'bg-blue-900 text-blue-200 border-blue-700 animate-pulse' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
            {status === 'idle' ? 'I Am Ready...!' : status}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 p-6 overflow-hidden">
        <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* UPLOAD PANEL */}
            <div className="lg:col-span-4 flex flex-col h-full">
                <div className="bg-white rounded-xl shadow-lg border border-slate-300 flex flex-col flex-1 overflow-hidden relative">
                    <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center flex-none">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm"><FileText size={18} className="text-slate-500"/> Source Files</h3>
                        <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-1 rounded-full">{files.length} Files</span>
                    </div>
                    <div className="flex-1 relative bg-slate-50/50">
                        <div className="absolute inset-0 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                            {files.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
                                    <Upload size={40} className="mb-2"/><p className="text-xs font-medium">Drag Word & Excel files here</p>
                                </div>
                            )}
                            {files.map((f, i) => {
                                const isExcel = f.name.includes('.xls') || f.name.includes('.csv');
                                // NEW: Check if this file is already processed
                                const isProcessed = processedFileNames.includes(f.name);
                                
                                return (
                                    <div key={i} className={`p-3 rounded-lg border flex justify-between items-center shadow-sm transition-all hover:shadow-md ${isExcel ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            {isExcel ? <FileSpreadsheet size={18} className="text-green-600 flex-shrink-0"/> : <FileText size={18} className="text-blue-600 flex-shrink-0"/>}
                                            <div className="flex flex-col truncate">
                                                <span className="truncate text-xs font-bold text-slate-700">{f.name}</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-slate-400 uppercase">{isExcel ? 'Template' : 'Document'}</span>
                                                    {/* NEW: Visual indicator for processed files */}
                                                    {isProcessed && <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full"><CheckCircle size={10}/> Done</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <button onClick={() => setFiles(files.filter((_, ix) => ix !== i))} className="text-slate-300 hover:text-red-500 p-1"><Trash2 size={14}/></button>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                    <div className="p-4 border-t border-slate-200 bg-white flex-none">
                        <div className="relative border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl h-24 flex flex-col items-center justify-center hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer group">
                            <input type="file" multiple accept=".docx,.doc,.xlsx,.csv" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])}/>
                            <Upload size={24} className="text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
                            <span className="text-xs font-bold text-slate-500 group-hover:text-blue-600">Add Docs & Excel</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* CHAT PANEL */}
            <div className="lg:col-span-8 flex flex-col gap-5 h-full">
              <div className="bg-white rounded-xl shadow-lg border border-slate-300 flex flex-col flex-1 overflow-hidden relative">
                <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 flex justify-between items-center flex-none">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Processing Logs</span>
                    {status === 'processing' && <div className="flex items-center gap-2 text-blue-600 text-xs font-bold"><Loader2 size={14} className="animate-spin"/> Working...</div>}
                </div>
                <div className="flex-1 relative bg-slate-50">
                    <div className="absolute inset-0 overflow-y-auto p-5 space-y-4 custom-scrollbar pb-20">
                        {logs.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center opacity-30">
                                <Bot size={64} className="mb-4 text-slate-400"/>
                                <p className="text-sm font-medium text-slate-500">I am idle. Upload files to begin.</p>
                            </div>
                        )}
                        {logs.map((log, i) => (
                        <div key={i} className={`flex gap-3 ${log.type === 'system' || log.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {log.type !== 'system' && log.type !== 'user' && (
                                <div className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${log.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-600 text-white'}`}><Bot size={16}/></div>
                            )}
                            <div className={`
                                max-w-[85%] text-sm px-5 py-3 rounded-2xl shadow-sm border
                                ${log.type === 'user' ? 'bg-slate-800 text-white border-slate-900 rounded-tr-none' : 
                                log.type === 'system' ? 'bg-slate-200 text-slate-600 border-slate-300 text-xs font-bold py-1 px-3 rounded-full mx-auto' : 
                                log.type === 'error' ? 'bg-red-50 text-red-700 border-red-200 rounded-tl-none' : 
                                log.type === 'success' ? 'bg-green-50 text-green-700 border-green-200 rounded-tl-none' :
                                'bg-white text-slate-700 border-slate-200 rounded-tl-none'}
                            `}>
                                {log.text}
                            </div>
                        </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-white flex-none">
                    <form onSubmit={handleChatSubmit} className="relative flex items-center gap-3">
                        <input type="text" 
                            className="flex-1 bg-slate-100 border border-slate-300 rounded-xl pl-4 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner"
                            placeholder={status === 'complete' ? "Type to refine results (e.g. 'Add missing Row 5')..." : "Add instructions (e.g. 'Ignore traffic cases')..."}
                            value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                        />
                        <button type="submit" className="bg-slate-900 text-white p-3 rounded-xl hover:bg-slate-700 shadow-lg transition-transform active:scale-95"><Send size={18} /></button>
                    </form>
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="grid grid-cols-12 gap-4 h-14 flex-none">
                  <div className="col-span-4">
                    {status === 'idle' || status === 'complete' ? (
                        <button onClick={handleStart} className="w-full h-full bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 shadow-md border border-slate-900 flex items-center justify-center gap-2 text-sm transition-transform active:scale-95"><Play size={18} fill="currentColor" /> RUN EXTRACTION</button>
                    ) : (
                        <button onClick={handleStop} className="w-full h-full bg-red-50 text-red-600 border border-red-300 rounded-xl font-bold hover:bg-red-100 shadow-sm flex items-center justify-center gap-2 animate-pulse text-sm"><StopCircle size={18} /> STOP</button>
                    )}
                  </div>
                  <div className="col-span-4">
                      <button disabled={extractedData.length === 0} onClick={() => setShowPreview(true)} className={`w-full h-full rounded-xl border-2 flex items-center justify-center gap-2 font-bold text-sm transition-all ${extractedData.length > 0 ? 'bg-white text-slate-700 border-slate-300 hover:border-slate-400 hover:bg-slate-50 shadow-sm' : 'bg-slate-100 text-slate-300 border-slate-200'}`}><Eye size={18}/> Verify Data</button>
                  </div>
                  <div className="col-span-4">
                    <button disabled={extractedData.length === 0} onClick={downloadExcel} className={`w-full h-full rounded-xl border flex items-center justify-center gap-2 font-bold text-sm transition-all ${extractedData.length > 0 ? 'bg-green-600 text-white border-green-700 hover:bg-green-700 shadow-md' : 'bg-slate-100 text-slate-300 border-slate-200'}`}><Download size={18}/> Download</button>
                  </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;