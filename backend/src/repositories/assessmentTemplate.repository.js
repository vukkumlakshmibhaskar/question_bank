const prisma = require("../config/prisma");

const templateInclude = {
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  _count: {
    select: {
      testPapers: true,
    },
  },
};

class AssessmentTemplateRepository {
  async findMany(where) {
    return prisma.assessmentTemplate.findMany({
      where,
      include: templateInclude,
      orderBy: [
        { status: "asc" },
        { updatedAt: "desc" },
      ],
    });
  }

  async findById(id) {
    return prisma.assessmentTemplate.findUnique({
      where: { id: parseInt(id) },
      include: templateInclude,
    });
  }

  async create(data) {
    return prisma.assessmentTemplate.create({
      data,
      include: templateInclude,
    });
  }

  async update(id, data) {
    return prisma.assessmentTemplate.update({
      where: { id: parseInt(id) },
      data,
      include: templateInclude,
    });
  }
}

module.exports = new AssessmentTemplateRepository();
