import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export interface PWAStatus {
  canInstall: boolean;
  isInstalled: boolean;
  offlineReady: boolean;
}

type PWAStatusListener = (status: PWAStatus) => void;

export class PWAManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private offlineReady = false;
  private installed = false;
  private readonly listeners = new Set<PWAStatusListener>();

  private readonly onBeforeInstallBound: (e: Event) => void;
  private readonly onAppInstalledBound: () => void;

  constructor() {
    this.installed =
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((navigator as unknown as { standalone?: boolean }).standalone));

    this.onBeforeInstallBound = (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.emit();
    };

    this.onAppInstalledBound = () => {
      this.deferredPrompt = null;
      this.installed = true;
      this.emit();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', this.onBeforeInstallBound);
      window.addEventListener('appinstalled', this.onAppInstalledBound);
    }

    registerSW({
      immediate: true,
      onOfflineReady: () => {
        this.offlineReady = true;
        this.emit();
      },
      onRegisteredSW: () => {
        if (navigator.serviceWorker?.controller) {
          this.offlineReady = true;
          this.emit();
        }
      },
    });

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.ready
        .then(() => {
          this.offlineReady = true;
          this.emit();
        })
        .catch(() => {
          // Ignore SW readiness errors in unsupported contexts
        });
    }
  }

  public getStatus(): PWAStatus {
    return {
      canInstall: this.deferredPrompt !== null && !this.installed,
      isInstalled: this.installed,
      offlineReady: this.offlineReady,
    };
  }

  public subscribe(listener: PWAStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferredPrompt) return 'unavailable';
    try {
      await this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        this.deferredPrompt = null;
        this.installed = true;
        this.emit();
      }
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }

  private emit(): void {
    const snap = this.getStatus();
    this.listeners.forEach((fn) => fn(snap));
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeinstallprompt', this.onBeforeInstallBound);
      window.removeEventListener('appinstalled', this.onAppInstalledBound);
    }
    this.listeners.clear();
  }
}
