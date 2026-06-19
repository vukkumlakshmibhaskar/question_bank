const prisma = require("../config/prisma");
const { parsePagination, paginatedResponse } = require("../utils/pagination");

class AuditService {
  async log({ userId, action, entityType, entityId, oldValue = null, newValue = null }) {
    try {
      return await prisma.auditLog.create({
        data: {
          userId: userId ? parseInt(userId) : null,
          action,
          entityType,
          entityId: parseInt(entityId),
          oldValue: oldValue ? JSON.parse(JSON.stringify(oldValue)) : null,
          newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
        },
      });
    } catch (error) {
      console.error("Failed to write audit log:", error.message);
      // Null-safety: we catch and log errors to avoid blocking the main business transaction
    }
  }

  async getAuditLogs(filters = {}) {
    const where = {};
    if (filters.action && filters.action !== "ALL") {
      where.action = filters.action;
    }

    if (filters.search && String(filters.search).trim() !== "") {
      const search = String(filters.search).trim();
      const parsedEntityId = parseInt(search, 10);
      where.OR = [
        { action: { contains: search } },
        { entityType: { contains: search } },
        { user: { is: { name: { contains: search } } } },
        { user: { is: { email: { contains: search } } } },
      ];
      if (Number.isInteger(parsedEntityId)) {
        where.OR.push({ entityId: parsedEntityId });
      }
    }

    const pagination = parsePagination(filters);
    const query = {
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    };

    if (!pagination.wantsPagination) {
      return prisma.auditLog.findMany(query);
    }

    const [total, rows, actions] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.auditLog.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
    ]);

    return {
      ...paginatedResponse(rows, total, pagination),
      actions: actions.map((item) => item.action),
    };
  }
}

module.exports = new AuditService();
