export type OfflineStatus = 'checking' | 'ready' | 'unavailable' | 'failed' | 'reload-required';

export class OfflineApp {
  status: OfflineStatus = 'checking';
  registration?: ServiceWorkerRegistration;
  updateStatus: 'idle' | 'applying' | 'failed' | 'reload-required' = 'idle';
  private updateTimer?: ReturnType<typeof setTimeout>;
  private notify: () => void;
  private canReload: () => boolean;

  constructor(notify: () => void, canReload: () => boolean) {
    this.notify = notify;
    this.canReload = canReload;
    let controller = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
      const previous = controller;
      controller = navigator.serviceWorker.controller;
      if (previous && controller && previous !== controller) {
        clearTimeout(this.updateTimer);
        // Recheck at activation: edits can begin while the worker is starting.
        if (this.updateStatus === 'applying' && this.canReload()) { location.reload(); return; }
        this.updateStatus = 'reload-required'; this.notify();
      }
      void this.verify();
    });
  }

  async start(): Promise<void> {
    if (!isSecureContext || !('serviceWorker' in navigator)) {
      this.status = 'unavailable'; this.notify(); return;
    }
    this.status = 'checking'; this.notify();
    try {
      const base = new URL('../', new URL(import.meta.env.BASE_URL, location.origin));
      this.registration = await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname });
      this.registration.addEventListener('updatefound', () => {
        const worker = this.registration?.installing;
        worker?.addEventListener('statechange', () => {
          this.notify();
          if (worker.state === 'activated') void this.verify();
          if (worker.state === 'redundant') { this.status = 'failed'; this.notify(); }
        });
      });
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Offline setup timed out')), 15000)),
      ]);
      this.registration = ready;
      await this.verify(true);
    } catch {
      if (navigator.serviceWorker.controller) await this.verify();
      else { this.status = 'failed'; this.notify(); }
    }
  }

  async verify(repair = false): Promise<void> {
    if (!isSecureContext || !('serviceWorker' in navigator)) { this.status = 'unavailable'; this.notify(); return; }
    const worker = navigator.serviceWorker.controller ?? this.registration?.active;
    if (!worker) return;
    const result = await new Promise<{ ready: boolean; version?: string }>(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve({ ready: false }); }, 5000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close(); resolve({ ready: event.data?.ready === true, version: event.data?.appVersion });
      };
      try { worker.postMessage({ type: 'CHECK_READY', repair }, [channel.port2]); }
      catch { clearTimeout(timer); channel.port1.close(); resolve({ ready: false }); }
    });
    if (worker !== (navigator.serviceWorker.controller ?? this.registration?.active)) return;
    if (result.ready && result.version && result.version !== __APP_VERSION__) {
      clearTimeout(this.updateTimer);
      this.status = 'reload-required'; this.updateStatus = 'reload-required';
    } else this.status = result.ready && result.version === __APP_VERSION__ ? 'ready' : 'failed';
    this.notify();
  }

  applyUpdate(): boolean {
    if (this.updateStatus === 'applying' || !this.canReload()) return false;
    if (this.updateStatus === 'reload-required') {
      this.updateStatus = 'applying'; this.notify(); location.reload(); return true;
    }
    const worker = this.registration?.waiting;
    if (!worker || worker.state !== 'installed') {
      this.updateStatus = 'failed'; this.notify(); return false;
    }
    try {
      this.updateStatus = 'applying';
      worker.postMessage({ type: 'ACTIVATE_UPDATE' });
      this.updateTimer = setTimeout(() => {
        this.updateStatus = 'failed'; this.notify();
      }, 10000);
      this.notify(); return true;
    } catch {
      this.updateStatus = 'failed'; this.notify(); return false;
    }
  }
}
