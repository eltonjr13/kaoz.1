export const GOOGLE_DRIVE_STATE_VERSION = 1 as const;

export type GoogleDriveTransferKind = "download" | "upload";
export type GoogleDriveTransferStatus =
  | "queued"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

export interface GoogleDriveConfiguration {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  appId: string;
  defaultFolderId?: string;
  defaultFolderName?: string;
}

export interface GoogleDriveSelection {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  parentId?: string;
  webViewLink?: string;
}

export interface GoogleDriveConnectionStatus {
  version: typeof GOOGLE_DRIVE_STATE_VERSION;
  configured: boolean;
  connected: boolean;
  email?: string;
  defaultFolder?: { id: string; name: string };
  lastCheckedAt?: string;
  lastError?: string;
}

export interface GoogleDriveTransferJob {
  version: typeof GOOGLE_DRIVE_STATE_VERSION;
  id: string;
  kind: GoogleDriveTransferKind;
  status: GoogleDriveTransferStatus;
  createdAt: string;
  updatedAt: string;
  bytesTransferred: number;
  totalBytes?: number;
  sourceName: string;
  localPath?: string;
  remoteFileId?: string;
  remoteFolderId?: string;
  remoteUrl?: string;
  error?: string;
  idempotencyKey?: string;
}

export interface GoogleDriveStoredState {
  version: typeof GOOGLE_DRIVE_STATE_VERSION;
  configuration?: GoogleDriveConfiguration;
  oauth?: {
    refreshToken: string;
    email?: string;
    scope: string;
    connectedAt: string;
  };
  pendingAuthorization?: {
    state: string;
    codeVerifier: string;
    redirectUri: string;
    expiresAt: string;
  };
  lastCheckedAt?: string;
  lastError?: string;
}
