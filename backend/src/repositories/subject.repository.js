const prisma = require("../config/prisma");

class SubjectRepository {
  // --- Subject Queries ---
  async getHierarchy(search = "", assignedSubjectIds = null) {
    const whereClause = {
      isDeleted: false,
    };

    if (Array.isArray(assignedSubjectIds)) {
      whereClause.id = assignedSubjectIds.length > 0 ? { in: assignedSubjectIds } : { in: [-1] };
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    return prisma.subject.findMany({
      where: whereClause,
      include: {
        chapters: {
          where: { isDeleted: false },
          include: {
            concepts: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });
  }

  async findSubjectById(id) {
    return prisma.subject.findFirst({
      where: { id: parseInt(id), isDeleted: false },
      include: {
        chapters: {
          where: { isDeleted: false },
        },
      },
    });
  }

  async createSubject(data) {
    return prisma.subject.create({
      data: {
        name: data.name,
        description: data.description,
      },
    });
  }

  async updateSubject(id, data) {
    return prisma.subject.update({
      where: { id: parseInt(id) },
      data: {
        name: data.name,
        description: data.description,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
      },
    });
  }

  async deleteSubject(id) {
    return prisma.$transaction(async (tx) => {
      await tx.subject.update({
        where: { id: parseInt(id) },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
      });

      const chapters = await tx.chapter.findMany({
        where: { subjectId: parseInt(id) },
      });
      const chapterIds = chapters.map((c) => c.id);

      if (chapterIds.length > 0) {
        await tx.chapter.updateMany({
          where: { id: { in: chapterIds } },
          data: { isDeleted: true, deletedAt: new Date(), isActive: false },
        });

        await tx.concept.updateMany({
          where: { chapterId: { in: chapterIds } },
          data: { isDeleted: true, deletedAt: new Date(), isActive: false },
        });
      }
    });
  }

  // --- Chapter Queries ---
  async findChapterById(id) {
    return prisma.chapter.findFirst({
      where: { id: parseInt(id), isDeleted: false },
      include: {
        concepts: {
          where: { isDeleted: false },
        },
      },
    });
  }

  async createChapter(subjectId, data) {
    return prisma.chapter.create({
      data: {
        name: data.name,
        description: data.description,
        subjectId: parseInt(subjectId),
      },
    });
  }

  async updateChapter(id, data) {
    return prisma.chapter.update({
      where: { id: parseInt(id) },
      data: {
        name: data.name,
        description: data.description,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
      },
    });
  }

  async deleteChapter(id) {
    return prisma.$transaction(async (tx) => {
      await tx.chapter.update({
        where: { id: parseInt(id) },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
      });

      await tx.concept.updateMany({
        where: { chapterId: parseInt(id) },
        data: { isDeleted: true, deletedAt: new Date(), isActive: false },
      });
    });
  }

  // --- Concept Queries ---
  async findConceptById(id) {
    return prisma.concept.findFirst({
      where: { id: parseInt(id), isDeleted: false },
    });
  }

  async createConcept(chapterId, data) {
    return prisma.concept.create({
      data: {
        name: data.name,
        description: data.description,
        chapterId: parseInt(chapterId),
      },
    });
  }

  async updateConcept(id, data) {
    return prisma.concept.update({
      where: { id: parseInt(id) },
      data: {
        name: data.name,
        description: data.description,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
      },
    });
  }

  async deleteConcept(id) {
    return prisma.concept.update({
      where: { id: parseInt(id) },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
  }
}

module.exports = new SubjectRepository();
