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
      getNavigationState: () => Promise<Kaoz1NavigationState>;
      goBack: () => Promise<boolean>;
      goForward: () => Promise<boolean>;
      reload: () => Promise<boolean>;
      getDesktopPreferences: () => Promise<{ autoDownloadUpdates: boolean; closeToTray: boolean } | null>;
      setCloseToTray: (enabled: boolean) => Promise<{ closeToTray: boolean } | null>;
      setAutoDownloadUpdates: (enabled: boolean) => Promise<{ autoDownloadUpdates: boolean } | null>;
      chooseCourseFolder: () => Promise<string | null>;
      chooseVideoFile: () => Promise<string | null>;
      onMaximizedChanged: (listener: (isMaximized: boolean) => void) => () => void;
      onNavigationStateChanged: (listener: (state: Kaoz1NavigationState) => void) => () => void;
      getUpdateStatus: () => Promise<Kaoz1UpdateStatus>;
      checkForUpdates: () => Promise<Kaoz1UpdateStatus>;
      downloadUpdate: () => Promise<Kaoz1UpdateStatus>;
      installUpdate: () => Promise<boolean>;
      onUpdateStatus: (listener: (status: Kaoz1UpdateStatus) => void) => () => void;
    };
  }

  interface Kaoz1NavigationState {
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
  }
}
