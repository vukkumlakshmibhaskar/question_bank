export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export const createPagination = (pageSize = 10) => ({
  page: 1,
  pageSize,
  total: 0,
  totalPages: 1,
})

export const unpackPaginated = (payload, fallbackPagination) => {
  if (Array.isArray(payload)) {
    return {
      rows: payload,
      pagination: {
        ...fallbackPagination,
        total: payload.length,
        totalPages: Math.max(Math.ceil(payload.length / fallbackPagination.pageSize), 1),
      },
    }
  }

  return {
    rows: payload?.data || [],
    pagination: payload?.pagination || fallbackPagination,
    extra: payload || {},
  }
}
