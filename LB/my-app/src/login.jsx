import React, { useState } from 'react';
import { Shield, Lock, User, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';

const Login = ({ onLogin }) => {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

   
    setTimeout(() => {
      if (formData.username === 'admin' && formData.password === 'admin2007') {
        onLogin(true); 
      } else {
        setError('Invalid credentials. Please try again.');
        setIsLoading(false);
      }
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-slate-200 flex items-center justify-center p-4">
      {/* Card Container */}
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-300 animate-in fade-in zoom-in duration-500">
        
        {/* Header Section */}
        <div className="bg-slate-900 p-8 text-center relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 left-0 w-full h-full bg-blue-600/10 opacity-20 transform -skew-y-6 origin-top-left scale-150"></div>
          
          <div className="relative z-10 flex flex-col items-center">
            <div className=""><img src="DSR_Logo.png" alt="DSR_Logo" className="rounded-xl" style={{ padding: '5px' }} /></div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-1">imove4m</h1>
            <p className="text-slate-400 text-sm font-medium">Data Extraction Portal</p>
          </div>
        </div>

        {/* Form Section */}
        <div className="p-8 pt-10">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Username Input */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Username / ID</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User size={18} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input 
                  type="text"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm font-medium text-slate-700 placeholder-slate-400"
                  placeholder="Enter your ID"
                  value={formData.username}
                  onChange={(e) => setFormData({...formData, username: e.target.value})}
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Password</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input 
                  type={showPassword ? "text" : "password"}
                  required
                  className="w-full pl-10 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm font-medium text-slate-700 placeholder-slate-400"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 text-red-600 text-xs font-medium px-4 py-3 rounded-lg border border-red-100 flex items-center animate-pulse">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full mr-2"></div>
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 focus:ring-4 focus:ring-slate-200 transition-all transform active:scale-[0.98] shadow-lg flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Verifying...
                </>
              ) : (
                <>
                  Access Portal 💨
                </>
              )}
            </button>

          </form>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 p-4 text-center border-t border-slate-100">
          <p className="text-xs text-slate-400 font-medium">
            DOCEL VERSION • v1.0.2
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;