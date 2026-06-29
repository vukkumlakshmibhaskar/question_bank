const DEFAULT_TRANSLATION_API_BASE = "http://127.0.0.1:8024";

const SUPPORTED_TRANSLATION_LANGUAGES = [
  "Hindi",
  "Urdu",
  "Punjabi",
  "Bengali",
  "Tamil",
  "Malayalam",
  "Kannada",
  "Telugu",
  "Marathi",
  "Oriya",
  "Gujarati",
  "Konkani",
  "Manipuri",
  "Assamese",
  "Nepali",
  "Kashmiri",
  "Sanskrit",
  "Sindhi",
];

const answerLabel = (index) => String.fromCharCode(65 + index);

class TranslationService {
  getApiBase() {
    return (process.env.TRANSLATION_API_BASE || DEFAULT_TRANSLATION_API_BASE).replace(/\/+$/, "");
  }

  getSupportedLanguages() {
    return SUPPORTED_TRANSLATION_LANGUAGES;
  }

  async health() {
    return this.requestJson("/health", { method: "GET" }, 8000);
  }

  async submitGeneratedSet(paper, setItem, languages) {
    const targetLanguages = this.normalizeLanguages(languages);
    const payload = this.buildGeneratedSetPayload(paper, setItem, targetLanguages);
    const accepted = await this.requestJson("/api/v1/translate/questions", {
      method: "POST",
      body: JSON.stringify(payload),
    }, 30000);

    return {
      ...accepted,
      viewerUrls: this.viewerUrls(accepted.job_id, targetLanguages),
    };
  }

  async getJobStatus(jobId) {
    const status = await this.requestJson(`/api/v1/translate/questions/status/${encodeURIComponent(jobId)}`, {
      method: "GET",
    }, 15000);

    return {
      ...status,
      viewerUrls: this.viewerUrls(jobId, status.pdf_urls ? Object.keys(status.pdf_urls) : []),
    };
  }

  async getJobResult(jobId, language) {
    const suffix = language ? `?language=${encodeURIComponent(language)}` : "";
    return this.requestJson(`/api/v1/translate/questions/result/${encodeURIComponent(jobId)}${suffix}`, {
      method: "GET",
    }, 30000);
  }

  async requestJson(path, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${this.getApiBase()}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const message = data.detail || data.error || `Translation API failed with ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error("Translation API request timed out.");
        timeoutError.status = 504;
        throw timeoutError;
      }
      if (!error.status) {
        error.status = 502;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  normalizeLanguages(languages) {
    const requested = Array.isArray(languages) ? languages : [languages];
    const supported = new Set(SUPPORTED_TRANSLATION_LANGUAGES);
    const normalized = [...new Set(
      requested
        .map((language) => String(language || "").trim())
        .filter(Boolean)
    )];

    if (normalized.length === 0) {
      const error = new Error("Select at least one target language.");
      error.status = 400;
      throw error;
    }

    const unsupported = normalized.filter((language) => !supported.has(language));
    if (unsupported.length > 0) {
      const error = new Error(`Unsupported translation language: ${unsupported.join(", ")}`);
      error.status = 400;
      throw error;
    }

    return normalized;
  }

  buildGeneratedSetPayload(paper, setItem, targetLanguages) {
    const questions = setItem.questions || [];
    const subjectName = this.subjectNameForPaper(paper, setItem);
    const headerText = this.buildHeaderHtml(paper, setItem, questions, subjectName);

    return {
      metadata: {
        request_id: `qbank-paper-${paper.id}-set-${setItem.id}-${Date.now()}`,
        source_language: "English",
        target_languages: targetLanguages,
        Set_Name: `SET ${setItem.label || "A"}`,
        Set_ID: String(setItem.id),
        Subjectcode: paper.codeNo || paper.id,
        SubjectName: subjectName,
        YearMonth: this.yearMonthForPaper(paper),
      },
      headerText,
      totalQuestions: questions.length,
      questions: this.buildQuestions(questions),
    };
  }

  buildQuestions(links) {
    let lastSectionKey = "";

    return links.map((link, index) => {
      const question = link.question || {};
      const sectionName = link.sectionName || link.generationSnapshot?.sectionName || question.sectionName || "";
      const sectionKey = sectionName.trim().toLowerCase();
      const showSectionHeader = sectionName && sectionKey !== lastSectionKey;
      lastSectionKey = sectionKey || lastSectionKey;

      return {
        questionNumber: String(link.displayOrder || index + 1),
        questionText: question.content || "",
        marks: String(link.marks || question.marks || ""),
        sectionHeader: showSectionHeader ? sectionName : null,
        questionImageUrl: this.absoluteMediaUrl(question.imageUrl),
        imageUrl: this.absoluteMediaUrl(question.imageUrl),
        questionType: question.questionTypeLabel || question.type || "",
        options: (question.answers || []).map((answer, answerIndex) => ({
          label: answer.label || answerLabel(answerIndex),
          text: answer.content || "",
          isCorrect: Boolean(answer.isCorrect),
          questionImageUrl: this.absoluteMediaUrl(answer.imageUrl),
          imageUrl: this.absoluteMediaUrl(answer.imageUrl),
        })),
      };
    });
  }

  buildHeaderHtml(paper, setItem, questions, subjectName) {
    const questionCount = questions.length || setItem.questionCount || 0;
    const sectionLines = this.sectionSummaries(questions)
      .map((section) => {
        const range = section.start === section.end
          ? `Q. No. ${section.start}`
          : `Q. No. ${section.start} to ${section.end}`;
        return `<li><strong>${this.escapeHtml(section.name)} consists of</strong> ${this.escapeHtml(range)} - ${section.count} question(s), ${this.escapeHtml(section.marksText)} each.</li>`;
      })
      .join("");

    return `
      <div style="text-align:center;font-weight:bold;margin-bottom:10px;">${this.escapeHtml(subjectName).toUpperCase()}</div>
      <div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:10px;">
        <span><strong>Time :</strong> ${this.escapeHtml(paper.timingText || this.formatMinutes(paper.durationMinutes))}</span>
        <span><strong>Maximum Marks :</strong> ${this.escapeHtml(paper.totalMarks || setItem.totalMarks || "")}</span>
      </div>
      <p><strong>Code No.</strong> ${this.escapeHtml(paper.codeNo || "")} <strong>SET - [ ${this.escapeHtml(setItem.label || "A")} ]</strong></p>
      <p>This question paper consists of <strong>${questionCount}</strong> questions in all.</p>
      <p>All questions are compulsory unless optional questions are mentioned in the section instructions.</p>
      <ol>${sectionLines}</ol>
    `;
  }

  sectionSummaries(links) {
    const groups = new Map();

    links.forEach((link, index) => {
      const name = link.sectionName || link.generationSnapshot?.sectionName || link.question?.sectionName || "Questions";
      const key = `${link.sectionOrder || 999}-${name}`;
      const group = groups.get(key) || {
        name,
        order: parseInt(link.sectionOrder) || 999,
        displayOrders: [],
        count: 0,
        marks: new Set(),
      };
      group.displayOrders.push(parseInt(link.displayOrder) || index + 1);
      group.count += 1;
      if (parseInt(link.marks)) group.marks.add(parseInt(link.marks));
      groups.set(key, group);
    });

    return Array.from(groups.values())
      .map((group) => {
        const start = Math.min(...group.displayOrders);
        const end = Math.max(...group.displayOrders);
        const marks = Array.from(group.marks);
        return {
          ...group,
          start,
          end,
          marksText: marks.length === 1 ? `${marks[0]} mark${marks[0] === 1 ? "" : "s"}` : "mixed marks",
        };
      })
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  }

  subjectNameForPaper(paper, setItem) {
    const firstQuestion = (setItem.questions || []).find((link) => link.question)?.question;
    return (
      paper.subject?.name ||
      firstQuestion?.concept?.chapter?.subject?.name ||
      paper.title ||
      "Question Paper"
    );
  }

  yearMonthForPaper(paper) {
    if (!paper.examDate) return "";
    const date = new Date(paper.examDate);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  formatMinutes(minutes) {
    const parsed = parseInt(minutes);
    if (!parsed) return "";
    if (parsed < 60) return `${parsed} min`;
    const hours = Math.floor(parsed / 60);
    const remaining = parsed % 60;
    return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
  }

  absoluteMediaUrl(value) {
    if (!value) return null;
    const url = String(value).trim();
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;

    const base = process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  viewerUrls(jobId, languages) {
    if (!jobId) return {};
    const uniqueLanguages = [...new Set((languages || []).filter(Boolean))];
    return uniqueLanguages.reduce((urls, language) => {
      urls[language] = `${this.getApiBase()}/job/${encodeURIComponent(jobId)}?language=${encodeURIComponent(language)}`;
      return urls;
    }, {});
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

module.exports = new TranslationService();
