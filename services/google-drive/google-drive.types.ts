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
  modifiedTime?: string;
  md5Checksum?: string;
  parentId?: string;
  webViewLink?: string;
}

export interface GoogleDriveConnectionStatus {
  version: typeof GOOGLE_DRIVE_STATE_VERSION;
  configured: boolean;
  isEnvConfigured?: boolean;
  connected: boolean;
  batchReady: boolean;
  missingScopes: string[];
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
  batchId?: string;
  itemId?: string;
  remoteAppProperties?: Record<string, string>;
}

export type GoogleDriveCourseIssueCode =
  | "missing-video"
  | "multiple-videos"
  | "download-denied"
  | "invalid-video"
  | "too-many-videos";

export interface GoogleDriveCourseIssue {
  code: GoogleDriveCourseIssueCode;
  moduleName: string;
  lessonName: string;
  message: string;
}

export interface GoogleDriveCourseLesson {
  id: string;
  index: number;
  moduleId: string;
  moduleName: string;
  moduleIndex: number;
  lessonId: string;
  lessonName: string;
  lessonIndex: number;
  file: GoogleDriveSelection;
}

export interface GoogleDriveCourseModule {
  id: string;
  name: string;
  index: number;
  lessons: GoogleDriveCourseLesson[];
}

export interface GoogleDriveCourseManifest {
  version: 1;
  id: string;
  root: GoogleDriveSelection;
  createdAt: string;
  totalBytes: number;
  requiredLocalBytes: number;
  availableLocalBytes: number;
  valid: boolean;
  issues: GoogleDriveCourseIssue[];
  modules: GoogleDriveCourseModule[];
  lessons: GoogleDriveCourseLesson[];
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
