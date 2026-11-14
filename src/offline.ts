export type OfflineStatus = 'checking' | 'ready' | 'unavailable' | 'failed';

export class OfflineApp {
  status: OfflineStatus = 'checking';
  registration?: ServiceWorkerRegistration;
  updateStatus: 'idle' | 'applying' | 'failed' = 'idle';
  private updateTimer?: ReturnType<typeof setTimeout>;
  private notify: () => void;

  constructor(notify: () => void) {
    this.notify = notify;
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.updateStatus === 'applying') { clearTimeout(this.updateTimer); location.reload(); }
      else void this.verify();
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
    const worker = navigator.serviceWorker.controller ?? this.registration?.active;
    if (!worker) return;
    const ready = await new Promise<boolean>(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 5000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready === true && event.data?.appVersion === __APP_VERSION__);
      };
      try { worker.postMessage({ type: 'CHECK_READY', repair }, [channel.port2]); }
      catch { clearTimeout(timer); channel.port1.close(); resolve(false); }
    });
    this.status = ready ? 'ready' : 'failed'; this.notify();
  }

  applyUpdate(): boolean {
    if (this.updateStatus === 'applying') return false;
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
