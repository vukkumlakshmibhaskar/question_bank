const subjectRepository = require("../repositories/subject.repository");
const subjectAccessService = require("./subjectAccess.service");

class SubjectService {
  // --- Subject ---
  async getSubjectHierarchy(search = "", user = null) {
    const assignedSubjectIds = await subjectAccessService.getAssignedSubjectIds(user);
    return subjectRepository.getHierarchy(search, assignedSubjectIds);
  }

  async createSubject(data) {
    if (!data.name || data.name.trim() === "") {
      const err = new Error("Subject name is required");
      err.statusCode = 400;
      throw err;
    }
    return subjectRepository.createSubject(data);
  }

  async updateSubject(id, data) {
    const subject = await subjectRepository.findSubjectById(id);
    if (!subject) {
      const err = new Error("Subject not found");
      err.statusCode = 404;
      throw err;
    }
    return subjectRepository.updateSubject(id, data);
  }

  async deleteSubject(id) {
    const subject = await subjectRepository.findSubjectById(id);
    if (!subject) {
      const err = new Error("Subject not found");
      err.statusCode = 404;
      throw err;
    }
    await subjectRepository.deleteSubject(id);
    return { success: true };
  }

  // --- Chapter ---
  async createChapter(subjectId, data) {
    const subject = await subjectRepository.findSubjectById(subjectId);
    if (!subject) {
      const err = new Error("Subject not found");
      err.statusCode = 404;
      throw err;
    }
    if (!data.name || data.name.trim() === "") {
      const err = new Error("Chapter name is required");
      err.statusCode = 400;
      throw err;
    }
    return subjectRepository.createChapter(subjectId, data);
  }

  async updateChapter(id, data) {
    const chapter = await subjectRepository.findChapterById(id);
    if (!chapter) {
      const err = new Error("Chapter not found");
      err.statusCode = 404;
      throw err;
    }
    return subjectRepository.updateChapter(id, data);
  }

  async deleteChapter(id) {
    const chapter = await subjectRepository.findChapterById(id);
    if (!chapter) {
      const err = new Error("Chapter not found");
      err.statusCode = 404;
      throw err;
    }
    await subjectRepository.deleteChapter(id);
    return { success: true };
  }

  // --- Concept ---
  async createConcept(chapterId, data) {
    const chapter = await subjectRepository.findChapterById(chapterId);
    if (!chapter) {
      const err = new Error("Chapter not found");
      err.statusCode = 404;
      throw err;
    }
    if (!data.name || data.name.trim() === "") {
      const err = new Error("Concept name is required");
      err.statusCode = 400;
      throw err;
    }
    return subjectRepository.createConcept(chapterId, data);
  }

  async updateConcept(id, data) {
    const concept = await subjectRepository.findConceptById(id);
    if (!concept) {
      const err = new Error("Concept not found");
      err.statusCode = 404;
      throw err;
    }
    return subjectRepository.updateConcept(id, data);
  }

  async deleteConcept(id) {
    const concept = await subjectRepository.findConceptById(id);
    if (!concept) {
      const err = new Error("Concept not found");
      err.statusCode = 404;
      throw err;
    }
    await subjectRepository.deleteConcept(id);
    return { success: true };
  }
}

module.exports = new SubjectService();
