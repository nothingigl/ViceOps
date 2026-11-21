interface ScreenOrientationWithLock extends ScreenOrientation {
  lock?: (orientation: 'landscape' | 'landscape-primary' | 'landscape-secondary') => Promise<void>;
}

export async function requestLandscapeFullscreen(): Promise<void> {
  try {
    const docEl = document.documentElement;
    if (!document.fullscreenElement && typeof docEl.requestFullscreen === 'function') {
      await docEl.requestFullscreen();
    }
  } catch {
    // Ignore if browser restricts fullscreen
  }

  try {
    const orient = window.screen?.orientation as ScreenOrientationWithLock | undefined;
    if (orient && typeof orient.lock === 'function') {
      await orient.lock('landscape');
    }
  } catch {
    // iOS Safari and desktop browsers do not support orientation.lock
  }
}

export class OrientationGuard {
  private readonly root: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'orientation-guard';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Поверните устройство горизонтально');
    this.root.innerHTML = `
      <div class="hud-glass orientation-card">
        <div class="orientation-icon" aria-hidden="true">📱</div>
        <div class="orientation-kicker">ГОРИЗОНТАЛЬНЫЙ РЕЖИМ</div>
        <h2 class="orientation-title">Поверните телефон горизонтально</h2>
        <p class="orientation-desc">
          Управление, 3D-гараж и тактический планшет адаптированы под альбомную ориентацию экрана.
        </p>
        <div class="orientation-actions">
          <button type="button" class="pause-btn pause-btn--primary" data-role="go-landscape">
            Полный экран (альбомный)
          </button>
          <button type="button" class="pause-btn pause-btn--secondary" data-role="dismiss-rotate">
            Продолжить вертикально
          </button>
        </div>
      </div>
    `;

    container.appendChild(this.root);

    this.root
      .querySelector<HTMLButtonElement>('[data-role="go-landscape"]')!
      .addEventListener('click', () => {
        void requestLandscapeFullscreen();
      });

    this.root
      .querySelector<HTMLButtonElement>('[data-role="dismiss-rotate"]')!
      .addEventListener('click', () => {
        this.root.classList.add('is-dismissed');
      });
  }

  public dispose(): void {
    this.root.remove();
  }
}
