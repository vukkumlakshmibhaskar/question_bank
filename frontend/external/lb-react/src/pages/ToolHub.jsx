import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, FileText, Languages, Sparkles } from 'lucide-react';

const tools = [
  {
    title: 'Standard Parser',
    label: 'QP/MS extraction',
    description: 'Extracts question paper and marking-scheme data into the production review table.',
    path: '/standard',
    icon: FileText,
    accent: 'blue',
    status: 'Gateway 8070 -> 8071-8079',
  },
  {
    title: 'Language Parser',
    label: 'Translation-ready extraction',
    description: 'Processes multilingual question sets and keeps the same verification workflow for translated content.',
    path: '/language',
    icon: Languages,
    accent: 'violet',
    status: 'Gateway 8090 -> 8081-8089',
  },
  {
    title: 'Question Crafter',
    label: 'Textbook to questions',
    description: 'Creates lesson-wise questions from textbook PDFs, with review, verification, and Excel export.',
    path: '/question-crafter',
    icon: BookOpenCheck,
    accent: 'emerald',
    status: 'Gateway 8100 -> 8101-8109',
  },
];

const accentClasses = {
  blue: {
    icon: 'bg-blue-600 text-white',
    pill: 'bg-blue-50 text-blue-700 border-blue-200',
    hover: 'hover:border-blue-300 hover:shadow-blue-100/80',
    button: 'text-blue-700 group-hover:bg-blue-600 group-hover:text-white',
  },
  violet: {
    icon: 'bg-violet-600 text-white',
    pill: 'bg-violet-50 text-violet-700 border-violet-200',
    hover: 'hover:border-violet-300 hover:shadow-violet-100/80',
    button: 'text-violet-700 group-hover:bg-violet-600 group-hover:text-white',
  },
  emerald: {
    icon: 'bg-emerald-600 text-white',
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    hover: 'hover:border-emerald-300 hover:shadow-emerald-100/80',
    button: 'text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white',
  },
};

export default function ToolHub() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-normal text-slate-900">ADS Production Tools</h1>
              <p className="text-sm font-semibold text-slate-500">Choose the workflow you want to run.</p>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 shadow-sm">
            3 tools ready
          </div>
        </header>

        <div className="grid flex-1 items-center gap-4 py-8 md:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const classes = accentClasses[tool.accent];
            return (
              <Link
                key={tool.path}
                to={tool.path}
                className={`group flex min-h-[340px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition-all ${classes.hover}`}
              >
                <div>
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${classes.icon}`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className={`rounded-md border px-3 py-1 text-xs font-black uppercase tracking-wide ${classes.pill}`}>
                      {tool.label}
                    </span>
                  </div>
                  <h2 className="text-xl font-black text-slate-900">{tool.title}</h2>
                  <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{tool.description}</p>
                </div>

                <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-100 pt-5">
                  <span className="text-xs font-bold text-slate-400">{tool.status}</span>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 transition-colors ${classes.button}`}>
                    <ArrowRight className="h-5 w-5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
