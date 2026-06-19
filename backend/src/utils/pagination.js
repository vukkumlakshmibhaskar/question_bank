const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;

const toPositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePagination = (query = {}) => {
  const wantsPagination = ["page", "pageSize", "limit", "offset"].some(
    (key) => query[key] !== undefined
  );
  const pageSize = Math.min(
    Math.max(toPositiveInt(query.pageSize ?? query.limit, DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE
  );
  const offsetValue = parseInt(query.offset, 10);
  const skip = Number.isInteger(offsetValue) && offsetValue >= 0
    ? offsetValue
    : (toPositiveInt(query.page, 1) - 1) * pageSize;
  const page = toPositiveInt(query.page, Math.floor(skip / pageSize) + 1);

  return {
    wantsPagination,
    page,
    pageSize,
    skip,
    take: pageSize,
  };
};

const paginatedResponse = (data, total, pagination) => ({
  data,
  pagination: {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pagination.pageSize), 1),
  },
});

module.exports = {
  parsePagination,
  paginatedResponse,
};
