export {};

declare global {
  interface MrChickenUpdateStatus {
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
    mrChickenDesktop?: {
      minimize: () => Promise<boolean>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      onMaximizedChanged: (listener: (isMaximized: boolean) => void) => () => void;
      getUpdateStatus: () => Promise<MrChickenUpdateStatus>;
      checkForUpdates: () => Promise<MrChickenUpdateStatus>;
      downloadUpdate: () => Promise<MrChickenUpdateStatus>;
      installUpdate: () => Promise<boolean>;
      onUpdateStatus: (listener: (status: MrChickenUpdateStatus) => void) => () => void;
    };
  }
}
