const XLSX = require("xlsx");
const sectionNormalizerService = require("./sectionNormalizer.service");

const text = (value) => String(value ?? "").trim();

const flattenQuestions = (data = {}) => {
  const rows = [];
  const chapters = Array.isArray(data.chapters) ? data.chapters : [];

  chapters.forEach((chapter, chapterIndex) => {
    const concepts = Array.isArray(chapter.concepts) ? chapter.concepts : [];
    concepts.forEach((concept, conceptIndex) => {
      const questions = Array.isArray(concept.questions) ? concept.questions : [];
      questions.forEach((question, questionIndex) => {
        rows.push({
          chapter,
          concept,
          question,
          chapterIndex,
          conceptIndex,
          questionIndex,
        });
      });
    });
  });

  return rows;
};

const appendSheet = (workbook, name, rows) => {
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, name);
};

class SectionReviewWorkbookService {
  buildReviewWorkbookBuffer(review) {
    const { extractedData } = sectionNormalizerService.normalizeExtractionData(review.extractedData, {
      enabled: true,
    });
    const questionRows = flattenQuestions(extractedData);
    const workbook = XLSX.utils.book_new();

    appendSheet(workbook, "Sections", this.buildSections(extractedData));
    appendSheet(workbook, "Questions", this.buildQuestions(questionRows));
    appendSheet(workbook, "Question Items", this.buildQuestionItems(questionRows));
    appendSheet(workbook, "Assets", this.buildAssets(questionRows));
    appendSheet(workbook, "Validation", this.buildValidation(extractedData));

    return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  }

  buildSections(data) {
    return (data.sectionMap?.sections || []).map((section) => ({
      sectionName: section.sectionName,
      sectionOrder: section.sectionOrder,
      startsAtQuestion: section.startsAtQuestion,
      endsAtQuestion: section.endsAtQuestion,
      confidence: section.confidence,
      evidence: (section.evidence || []).join(", "),
    }));
  }

  buildQuestions(questionRows) {
    return questionRows.map(({ chapter, concept, question }) => ({
      questionUid: question.questionUid,
      sectionName: question.sectionName,
      sectionOrder: question.sectionOrder,
      sourceQuestionNo: question.sourceQuestionNo || question.questionNo,
      pageNo: question.sourcePageNo,
      marks: question.marks,
      questionType: question.questionTypeLabel || question.type,
      subpartCount: question.subpartCount,
      choiceGroupKey: question.choiceGroupKey,
      sectionConfidence: question.sectionConfidence,
      chapter: chapter.name,
      concept: concept.name,
      questionText: question.content,
      questionHeader: question.questionHeader,
    }));
  }

  buildQuestionItems(questionRows) {
    const rows = [];
    for (const { question } of questionRows) {
      const answers = Array.isArray(question.answers) ? question.answers : [];
      answers.forEach((answer, index) => {
        rows.push({
          questionUid: question.questionUid,
          sourceQuestionNo: question.sourceQuestionNo || question.questionNo,
          itemType: "OPTION",
          itemLabel: String.fromCharCode(65 + index),
          content: answer.content,
          imageUrl: answer.imageUrl,
          isCorrect: Boolean(answer.isCorrect),
        });
      });

      if (question.choiceGroupKey) {
        rows.push({
          questionUid: question.questionUid,
          sourceQuestionNo: question.sourceQuestionNo || question.questionNo,
          itemType: "CHOICE_GROUP",
          itemLabel: question.choiceGroupKey,
          content: "",
          imageUrl: "",
          isCorrect: false,
        });
      }
    }
    return rows;
  }

  buildAssets(questionRows) {
    const assets = [];
    for (const { question } of questionRows) {
      if (question.imageUrl) {
        assets.push({
          questionUid: question.questionUid,
          sourceQuestionNo: question.sourceQuestionNo || question.questionNo,
          assetType: "QUESTION_IMAGE",
          url: question.imageUrl,
          pageNo: question.sourcePageNo,
        });
      }

      for (const [index, answer] of (question.answers || []).entries()) {
        if (!answer.imageUrl) continue;
        assets.push({
          questionUid: question.questionUid,
          sourceQuestionNo: question.sourceQuestionNo || question.questionNo,
          assetType: "OPTION_IMAGE",
          itemLabel: String.fromCharCode(65 + index),
          url: answer.imageUrl,
          pageNo: question.sourcePageNo,
        });
      }
    }
    return assets;
  }

  buildValidation(data) {
    return (data.sectionMap?.validation || []).map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      questionUid: issue.questionUid,
      sectionName: text(issue.sectionName),
      message: issue.message,
    }));
  }
}

module.exports = new SectionReviewWorkbookService();
