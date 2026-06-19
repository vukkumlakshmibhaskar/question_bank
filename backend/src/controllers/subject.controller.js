const subjectService = require("../services/subject.service");

class SubjectController {
  // --- Subject ---
  async getHierarchy(req, res, next) {
    try {
      const { search } = req.query;
      const hierarchy = await subjectService.getSubjectHierarchy(search, req.user);
      return res.status(200).json(hierarchy);
    } catch (error) {
      next(error);
    }
  }

  async createSubject(req, res, next) {
    try {
      const { name, description } = req.body;
      const subject = await subjectService.createSubject({ name, description });
      return res.status(201).json({ message: "Subject created successfully", subject });
    } catch (error) {
      next(error);
    }
  }

  async updateSubject(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      const subject = await subjectService.updateSubject(id, { name, description });
      return res.status(200).json({ message: "Subject updated successfully", subject });
    } catch (error) {
      next(error);
    }
  }

  async deleteSubject(req, res, next) {
    try {
      const { id } = req.params;
      await subjectService.deleteSubject(id);
      return res.status(200).json({ message: "Subject deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  // --- Chapter ---
  async createChapter(req, res, next) {
    try {
      const { subjectId } = req.params;
      const { name, description } = req.body;
      const chapter = await subjectService.createChapter(subjectId, { name, description });
      return res.status(201).json({ message: "Chapter created successfully", chapter });
    } catch (error) {
      next(error);
    }
  }

  async updateChapter(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      const chapter = await subjectService.updateChapter(id, { name, description });
      return res.status(200).json({ message: "Chapter updated successfully", chapter });
    } catch (error) {
      next(error);
    }
  }

  async deleteChapter(req, res, next) {
    try {
      const { id } = req.params;
      await subjectService.deleteChapter(id);
      return res.status(200).json({ message: "Chapter deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  // --- Concept ---
  async createConcept(req, res, next) {
    try {
      const { chapterId } = req.params;
      const { name, description } = req.body;
      const concept = await subjectService.createConcept(chapterId, { name, description });
      return res.status(201).json({ message: "Concept created successfully", concept });
    } catch (error) {
      next(error);
    }
  }

  async updateConcept(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      const concept = await subjectService.updateConcept(id, { name, description });
      return res.status(200).json({ message: "Concept updated successfully", concept });
    } catch (error) {
      next(error);
    }
  }

  async deleteConcept(req, res, next) {
    try {
      const { id } = req.params;
      await subjectService.deleteConcept(id);
      return res.status(200).json({ message: "Concept deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubjectController();
