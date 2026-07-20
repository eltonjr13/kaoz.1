export {};

declare global {
  interface Window {
    mrChickenDesktop?: {
      minimize: () => Promise<boolean>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      onMaximizedChanged: (listener: (isMaximized: boolean) => void) => () => void;
    };
  }
}
