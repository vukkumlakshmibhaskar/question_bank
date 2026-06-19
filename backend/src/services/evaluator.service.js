const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const prisma = require("../config/prisma");
const auditService = require("./audit.service");

const MAX_TEMPLATE_ROWS = 500;
const UPLOAD_ROOT = path.resolve(__dirname, "../../public/uploads");
const REQUIRED_FIELDS = ["Full Name", "Mobile", "Designation"];

const TEMPLATE_COLUMNS = [
  "Row No.",
  "Full Name",
  "Mobile",
  "Email",
  "PAN",
  "Aadhaar",
  "Designation",
  "Document Key",
  "Remarks",
];

const cleanText = (value) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
};

const normalizeKey = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();

class EvaluatorService {
  async list(filters = {}) {
    const page = Math.max(parseInt(filters.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(filters.pageSize) || 10, 1), 100);
    const where = this.buildWhere(filters);

    const [total, rows] = await Promise.all([
      prisma.evaluator.count({ where }),
      prisma.evaluator.findMany({
        where,
        include: {
          _count: {
            select: { documents: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  buildWhere(filters) {
    const where = {};
    const containsFields = [
      ["name", "fullName"],
      ["mobile", "mobile"],
      ["email", "email"],
      ["pan", "pan"],
      ["aadhaar", "aadhaar"],
      ["designation", "designation"],
    ];

    for (const [filterKey, field] of containsFields) {
      const text = cleanText(filters[filterKey]);
      if (text) where[field] = { contains: text };
    }

    const search = cleanText(filters.search);
    if (search) {
      where.OR = ["fullName", "mobile", "email", "pan", "aadhaar", "designation"].map((field) => ({
        [field]: { contains: search },
      }));
    }

    return where;
  }

  buildTemplate(rowCountInput) {
    const rowCount = Math.min(Math.max(parseInt(rowCountInput) || 25, 1), MAX_TEMPLATE_ROWS);
    const workbook = XLSX.utils.book_new();
    const templateRows = Array.from({ length: rowCount }, (_, index) => ({
      "Row No.": index + 1,
      "Full Name": "",
      Mobile: "",
      Email: "",
      PAN: "",
      Aadhaar: "",
      Designation: "",
      "Document Key": "",
      Remarks: "",
    }));

    templateRows[0] = {
      "Row No.": 1,
      "Full Name": "Sample Evaluator",
      Mobile: "9876543210",
      Email: "sample@example.com",
      PAN: "ABCDE1234F",
      Aadhaar: "123412341234",
      Designation: "Senior Evaluator",
      "Document Key": "ABCDE1234F",
      Remarks: "Replace this sample row",
    };

    const infoRows = [
      ["Template", "Evaluator Bulk Upload"],
      ["Version", "EVALUATOR-XLSM-2026-06-12"],
      ["Generated On", new Date().toISOString()],
      ["Maximum Rows", MAX_TEMPLATE_ROWS],
      ["Required Fields", REQUIRED_FIELDS.join(", ")],
    ];

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(infoRows), "Template Info");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(templateRows, { header: TEMPLATE_COLUMNS }), "Evaluators");

    return {
      rowCount,
      filename: `Evaluator_Bulk_Upload_Template_${rowCount}_Rows.xlsm`,
      buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsm" }),
    };
  }

  async bulkUpload({ excelFile, documentFiles = [], user }) {
    if (!excelFile) {
      this.throwValidation("Completed evaluator Excel file is required.");
    }

    const rows = this.parseExcelRows(excelFile.path);
    const validationErrors = this.validateRows(rows);

    if (validationErrors.length > 0) {
      await this.cleanupFiles([excelFile, ...documentFiles]);
      const err = new Error("Evaluator upload validation failed.");
      err.statusCode = 400;
      err.details = validationErrors;
      throw err;
    }

    const result = await prisma.$transaction(async (tx) => {
      const evaluators = [];
      let created = 0;
      let updated = 0;

      for (const row of rows) {
        const existing = await this.findExistingEvaluator(tx, row);
        const data = {
          fullName: row.fullName,
          mobile: row.mobile,
          email: row.email,
          pan: row.pan,
          aadhaar: row.aadhaar,
          designation: row.designation,
          rowNumber: row.rowNumber,
          uploadedById: parseInt(user.id),
        };

        const evaluator = existing
          ? await tx.evaluator.update({ where: { id: existing.id }, data })
          : await tx.evaluator.create({ data });

        if (existing) updated += 1;
        else created += 1;

        evaluators.push({
          ...evaluator,
          documentKey: row.documentKey,
        });
      }

      const documentRows = [];
      for (const file of documentFiles) {
        const evaluator = this.matchEvaluatorForFile(file, evaluators);
        if (!evaluator) continue;

        documentRows.push(await tx.evaluatorDocument.create({
          data: {
            evaluatorId: evaluator.id,
            fileName: file.filename,
            originalName: file.originalname,
            filePath: `/uploads/${file.filename}`,
            fileSize: file.size,
            mimeType: file.mimetype,
            documentType: this.documentTypeFromName(file.originalname),
            uploadedById: parseInt(user.id),
          },
        }));
      }

      return {
        created,
        updated,
        documentCount: documentRows.length,
        evaluatorIds: evaluators.map((item) => item.id),
      };
    });

    await fs.promises.unlink(excelFile.path).catch(() => {});

    await auditService.log({
      userId: user.id,
      action: "UPLOAD_EVALUATOR_BULK",
      entityType: "Evaluator",
      entityId: result.evaluatorIds[0] || user.id,
      newValue: result,
    });

    return result;
  }

  parseExcelRows(filePath) {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = workbook.SheetNames.includes("Evaluators") ? "Evaluators" : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    return rows
      .filter((row) => TEMPLATE_COLUMNS.some((column) => cleanText(row[column])))
      .map((row, index) => ({
        rowNumber: parseInt(row["Row No."]) || index + 2,
        fullName: cleanText(row["Full Name"]),
        mobile: cleanText(row.Mobile),
        email: cleanText(row.Email),
        pan: cleanText(row.PAN)?.toUpperCase() || null,
        aadhaar: cleanText(row.Aadhaar),
        designation: cleanText(row.Designation),
        documentKey: cleanText(row["Document Key"]),
      }));
  }

  validateRows(rows) {
    const errors = [];
    if (rows.length === 0) {
      errors.push({ rowNumber: null, errors: ["Excel file does not contain evaluator rows."] });
      return errors;
    }

    rows.forEach((row) => {
      const rowErrors = [];
      if (!row.fullName) rowErrors.push("Full Name is required.");
      if (!row.mobile) rowErrors.push("Mobile is required.");
      if (!row.designation) rowErrors.push("Designation is required.");
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) rowErrors.push("Email format is invalid.");
      if (rowErrors.length > 0) {
        errors.push({ rowNumber: row.rowNumber, errors: rowErrors });
      }
    });

    return errors;
  }

  async findExistingEvaluator(tx, row) {
    const or = [];
    if (row.pan) or.push({ pan: row.pan });
    if (row.aadhaar) or.push({ aadhaar: row.aadhaar });
    if (row.mobile) or.push({ mobile: row.mobile });
    if (row.email) or.push({ email: row.email });
    if (or.length === 0) return null;

    return tx.evaluator.findFirst({ where: { OR: or } });
  }

  matchEvaluatorForFile(file, evaluators) {
    if (evaluators.length === 0) return null;
    const fileKey = normalizeKey(file.originalname);

    const match = evaluators.find((evaluator) => {
      return [evaluator.documentKey, evaluator.pan, evaluator.aadhaar, evaluator.mobile, evaluator.email]
        .filter(Boolean)
        .some((value) => fileKey.includes(normalizeKey(value)));
    });

    return match || evaluators[0];
  }

  documentTypeFromName(name) {
    const text = String(name || "").toLowerCase();
    if (text.includes("pan")) return "PAN";
    if (text.includes("aadhaar") || text.includes("aadhar")) return "AADHAAR";
    if (text.includes("photo") || text.includes("image")) return "IMAGE";
    return "GENERAL";
  }

  async getDocuments(evaluatorId, user) {
    const evaluator = await prisma.evaluator.findUnique({
      where: { id: parseInt(evaluatorId) },
      include: {
        documents: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!evaluator) {
      this.throwNotFound("Evaluator not found.");
    }

    await auditService.log({
      userId: user.id,
      action: "VIEW_EVALUATOR_DOCUMENTS",
      entityType: "Evaluator",
      entityId: evaluator.id,
      newValue: { documentCount: evaluator.documents.length },
    });

    return evaluator;
  }

  async getDocumentForDownload(documentId, user) {
    const document = await prisma.evaluatorDocument.findUnique({
      where: { id: parseInt(documentId) },
      include: { evaluator: true },
    });

    if (!document) {
      this.throwNotFound("Evaluator document not found.");
    }

    const absolutePath = path.resolve(UPLOAD_ROOT, document.filePath.replace(/^\/?uploads[\\/]/, ""));
    if (!absolutePath.startsWith(UPLOAD_ROOT)) {
      this.throwValidation("Document path is invalid.");
    }

    await auditService.log({
      userId: user.id,
      action: "DOWNLOAD_EVALUATOR_DOCUMENT",
      entityType: "EvaluatorDocument",
      entityId: document.id,
      newValue: {
        evaluatorId: document.evaluatorId,
        fileName: document.originalName,
      },
    });

    return {
      document,
      absolutePath,
      exists: fs.existsSync(absolutePath),
    };
  }

  async cleanupFiles(files) {
    await Promise.all((files || []).map((file) => fs.promises.unlink(file.path).catch(() => {})));
  }

  throwValidation(message) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  throwNotFound(message) {
    const err = new Error(message);
    err.statusCode = 404;
    throw err;
  }
}

module.exports = new EvaluatorService();
