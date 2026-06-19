const { google } = require("googleapis");
const fs = require("fs");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5000/api/uploads/drive/callback";

class GoogleDriveService {
  constructor() {
    this.oauth2Client = null;
    if (CLIENT_ID && CLIENT_SECRET) {
      this.oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    }
    
    // Application-level service account auth
    this.serviceAccountAuth = null;
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
    let privateKey = privateKeyRaw;
    if (privateKey) {
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
      } else if (privateKey.startsWith("'") && privateKey.endsWith("'")) {
        privateKey = privateKey.slice(1, -1);
      }
      privateKey = privateKey.replace(/\\n/g, '\n');
    }
    
    if (clientEmail && privateKey) {
      this.serviceAccountAuth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/drive']
      });
    }

    // System-level OAuth2 user client (workaround for personal @gmail.com accounts)
    this.systemUserAuth = null;
    const systemRefreshToken = process.env.GOOGLE_USER_REFRESH_TOKEN;
    if (CLIENT_ID && CLIENT_SECRET && systemRefreshToken) {
      this.systemUserAuth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      this.systemUserAuth.setCredentials({
        refresh_token: systemRefreshToken
      });
    }

    this.rawFolderId = process.env.GOOGLE_DRIVE_RAW_FOLDER_ID;
    this.processedFolderId = process.env.GOOGLE_DRIVE_PROCESSED_FOLDER_ID;
  }

  getAppAuth() {
    return this.systemUserAuth || this.serviceAccountAuth;
  }

  getAuthUrl() {
    if (!this.oauth2Client) {
      return "mock_auth_url_for_debugging";
    }

    const scopes = [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/drive", // Requires full access to upload/delete/modify files
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
    });
  }

  async getTokensFromCode(code) {
    if (!this.oauth2Client) {
      return { access_token: "mock_access_token", refresh_token: "mock_refresh_token" };
    }
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  getClient(accessToken, refreshToken) {
    const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return client;
  }

  async listPdfFiles(authClient) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.log("Mock Mode: Simulating Google Drive files list...");
      return [
        { id: "gdrive-file-1", name: "AP_Physics_Sample_Exam.pdf", mimeType: "application/pdf", size: "102450" },
        { id: "gdrive-file-2", name: "Chemistry_Quiz_Section_3.pdf", mimeType: "application/pdf", size: "235400" },
        { id: "gdrive-file-3", name: "History_Final_Review.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: "45000" },
      ];
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    const response = await drive.files.list({
      pageSize: 20,
      q: "mimeType = 'application/pdf' and trashed = false",
      fields: "files(id, name, mimeType, size)",
    });

    return response.data.files || [];
  }

  async downloadFile(authClient, fileId, destPath) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.log(`Mock Mode: Simulating downloading File ID #${fileId} to ${destPath}`);
      fs.writeFileSync(destPath, "%PDF-1.4 mock google drive document content");
      return { name: "AP_Physics_Sample_Exam.pdf", size: 45, mimeType: "application/pdf" };
    }

    const drive = google.drive({ version: "v3", auth: authClient });

    // Fetch metadata
    const metadata = await drive.files.get({
      fileId,
      fields: "name, size, mimeType",
    });

    const destStream = fs.createWriteStream(destPath);

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    return new Promise((resolve, reject) => {
      response.data
        .on("error", reject)
        .pipe(destStream)
        .on("finish", () => {
          resolve({
            name: metadata.data.name,
            size: parseInt(metadata.data.size || "0"),
            mimeType: metadata.data.mimeType,
          });
        })
        .on("error", reject);
    });
  }

  async uploadFile(authClient, localFilePath, fileName, parentFolderId = null) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.log(`Mock Mode: Simulating uploading ${localFilePath} to Drive as ${fileName}...`);
      return { id: "mock-uploaded-file-id", name: fileName };
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    const fileMetadata = {
      name: fileName,
      mimeType: "application/pdf",
    };

    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId];
    }

    const media = {
      mimeType: "application/pdf",
      body: fs.createReadStream(localFilePath),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id, name",
    });

    return response.data;
  }

  async deleteFile(authClient, fileId) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.log(`Mock Mode: Simulating deleting Drive file ID #${fileId}...`);
      return { success: true };
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    await drive.files.delete({
      fileId: fileId,
    });
    return { success: true };
  }

  async moveFile(authClient, fileId, targetFolderId) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.log(`Mock Mode: Simulating moving Drive file ID #${fileId} to folder ID #${targetFolderId}...`);
      return { success: true };
    }

    const drive = google.drive({ version: "v3", auth: authClient });

    // Retrieve previous parents to remove them
    const file = await drive.files.get({
      fileId: fileId,
      fields: "parents",
    });
    const previousParents = (file.data.parents || []).join(",");

    const response = await drive.files.update({
      fileId: fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      fields: "id, parents",
    });

    return response.data;
  }

  async initializeFolder(authClient, folderName, parentFolderId = null) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.log(`Mock Mode: Simulating folder initialization for '${folderName}'...`);
      return "mock-initialized-folder-id";
    }

    const drive = google.drive({ version: "v3", auth: authClient });

    // 1. Check if folder already exists
    let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`;
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`;
    }

    const listResponse = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      pageSize: 1,
    });

    const existingFolder = listResponse.data.files?.[0];
    if (existingFolder) {
      return existingFolder.id;
    }

    // 2. Create the folder if not found
    const fileMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    };

    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId];
    }

    const createResponse = await drive.files.create({
      resource: fileMetadata,
      fields: "id",
    });

    return createResponse.data.id;
  }
  // === Application-Level Methods (System User / Service Account) ===

  async uploadAppFile(localFilePath, fileName, mimeType, folderType = 'RAW') {
    const authClient = this.getAppAuth();
    if (!authClient) {
      console.log(`Mock Mode: Simulating App-level upload of ${fileName} to ${folderType} folder.`);
      return `mock-${folderType.toLowerCase()}-file-id-${Date.now()}`;
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    const targetFolderId = folderType === 'RAW' ? this.rawFolderId : this.processedFolderId;
    
    if (!targetFolderId) {
      throw new Error(`Google Drive folder ID for ${folderType} is not configured.`);
    }

    const fileMetadata = {
      name: fileName,
      parents: [targetFolderId]
    };

    const media = {
      mimeType: mimeType,
      body: fs.createReadStream(localFilePath)
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id"
    });

    return response.data.id;
  }
  
  async uploadAppFileFromBuffer(buffer, fileName, mimeType, folderType = 'PROCESSED') {
    const authClient = this.getAppAuth();
    if (!authClient) {
      console.log(`Mock Mode: Simulating App-level upload from buffer to ${folderType} folder.`);
      return `mock-${folderType.toLowerCase()}-file-id-${Date.now()}`;
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    const targetFolderId = folderType === 'RAW' ? this.rawFolderId : this.processedFolderId;
    
    if (!targetFolderId) {
      throw new Error(`Google Drive folder ID for ${folderType} is not configured.`);
    }

    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const fileMetadata = {
      name: fileName,
      parents: [targetFolderId]
    };

    const media = {
      mimeType: mimeType,
      body: bufferStream
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id"
    });

    return response.data.id;
  }

  async downloadAppFile(fileId, destPath) {
    const authClient = this.getAppAuth();
    if (!authClient) {
      console.log(`Mock Mode: Simulating App-level download of file ${fileId} to ${destPath}.`);
      fs.writeFileSync(destPath, "mock file content");
      return destPath;
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    const destStream = fs.createWriteStream(destPath);
    
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    return new Promise((resolve, reject) => {
      response.data
        .on("error", reject)
        .pipe(destStream)
        .on("finish", () => resolve(destPath))
        .on("error", reject);
    });
  }

  async deleteAppFile(fileId) {
    const authClient = this.getAppAuth();
    if (!authClient) {
      console.log(`Mock Mode: Simulating App-level delete of file ${fileId}.`);
      return { success: true };
    }

    const drive = google.drive({ version: "v3", auth: authClient });
    await drive.files.delete({
      fileId: fileId,
    });
    return { success: true };
  }
}

module.exports = new GoogleDriveService();
