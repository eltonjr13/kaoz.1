export {};

declare global {
  interface Kaoz1UpdateStatus {
    state: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "not-available" | "unsupported" | "error";
    currentVersion?: string;
    supported?: boolean;
    version?: string;
    releaseDate?: string;
    progress?: number;
    error?: string;
    errorCode?: "release-metadata-missing" | "network" | "unknown";
  }

  interface Window {
    kaoz1Desktop?: {
      minimize: () => Promise<boolean>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      getDesktopPreferences: () => Promise<{ closeToTray: boolean } | null>;
      setCloseToTray: (enabled: boolean) => Promise<{ closeToTray: boolean } | null>;
      onMaximizedChanged: (listener: (isMaximized: boolean) => void) => () => void;
      getUpdateStatus: () => Promise<Kaoz1UpdateStatus>;
      checkForUpdates: () => Promise<Kaoz1UpdateStatus>;
      downloadUpdate: () => Promise<Kaoz1UpdateStatus>;
      installUpdate: () => Promise<boolean>;
      onUpdateStatus: (listener: (status: Kaoz1UpdateStatus) => void) => () => void;
    };
  }
}
