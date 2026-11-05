import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MockHls, instances, supported } = vi.hoisted(() => {
  const supported = { value: true };
  class MockHls {
    static isSupported = () => supported.value;
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    handlers = new Map<string, (...args: unknown[]) => void>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    recoverMediaError = vi.fn();
    constructor() { instances.push(this); }
    on(name: string, callback: (...args: unknown[]) => void) { this.handlers.set(name, callback); }
  }
  const instances: MockHls[] = [];
  return { MockHls, instances, supported };
});
vi.mock('hls.js', () => ({ default: MockHls }));
vi.mock('./hls-loader', () => ({ createHlsLoader: vi.fn(() => class {}) }));
import { attachBrowserPlayback } from './browser-player';

class FakeVideo extends EventTarget {
  src = '';
  dataset: Record<string, string> = {};
  controls = false;
  disableRemotePlayback = true;
  paused = false;
  readyState = 0;
  duration = NaN;
  currentTime = 0;
  canPlayType = vi.fn(() => '');
  load = vi.fn();
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
}
const url = 'https://media.example/episode.m3u8';
const opts = () => ({ userAgent: 'Quark/7.0', adFilter: true, onError: vi.fn(), onHint: vi.fn(), onPause: vi.fn() });
const attach = (video: FakeVideo, options: Parameters<typeof attachBrowserPlayback>[2] = opts(), target = url) => attachBrowserPlayback(video as unknown as HTMLVideoElement, target, options);

beforeEach(() => {
  instances.length = 0;
  supported.value = true;
  const doc = Object.assign(new EventTarget(), { baseURI: 'https://tv.example/watch', visibilityState: 'visible' });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('location', { origin: 'https://tv.example' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser playback', () => {
  it('gives Quark a real HLS URL and native controls even without advertised HLS support', () => {
    const video = new FakeVideo();
    const dispose = attach(video);
    expect(video.src).toBe(url);
    expect(video.controls).toBe(true);
    expect(video.disableRemotePlayback).toBe(false);
    expect(instances).toHaveLength(0);
    dispose();
  });

  it('tries an authenticated same-origin URL before resorting to an HLS bridge', () => {
    const video = new FakeVideo();
    const dispose = attach(video);
    video.dispatchEvent(new Event('error'));
    expect(video.src).toBe('/api/proxy?url=' + encodeURIComponent(url));
    expect(instances).toHaveLength(0);
    video.dispatchEvent(new Event('error'));
    expect(instances).toHaveLength(1);
    expect(instances[0].loadSource).toHaveBeenCalledWith(video.src);
    dispose();
  });

  it('does not wrap an absolute same-origin proxy URL in another proxy', () => {
    const video = new FakeVideo();
    const proxy = 'https://tv.example/api/proxy?url=' + encodeURIComponent(url);
    const dispose = attach(video, opts(), proxy);
    video.dispatchEvent(new Event('error'));
    expect(instances).toHaveLength(1);
    expect(instances[0].loadSource).toHaveBeenCalledWith(proxy);
    dispose();
  });

  it('falls back promptly when native playback starts but never receives metadata', () => {
    vi.useFakeTimers();
    const video = new FakeVideo();
    const dispose = attach(video);
    video.dispatchEvent(new Event('play'));
    vi.advanceTimersByTime(12000);
    expect(video.src).toContain('/api/proxy?url=');
    dispose();
  });

  it('does not switch media while autoplay is blocked or after native metadata arrives', () => {
    vi.useFakeTimers();
    const video = new FakeVideo();
    video.paused = true;
    const dispose = attach(video);
    video.dispatchEvent(new Event('waiting'));
    vi.advanceTimersByTime(15000);
    expect(video.src).toBe(url);
    video.paused = false;
    video.dispatchEvent(new Event('play'));
    video.readyState = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
    vi.advanceTimersByTime(15000);
    expect(video.src).toBe(url);
    dispose();
  });

  it('uses hls.js with browser controls when the browser cannot load native HLS', () => {
    const video = new FakeVideo();
    const dispose = attach(video, { ...opts(), userAgent: 'Firefox/140' });
    expect(video.controls).toBe(true);
    expect(instances[0].loadSource).toHaveBeenCalledWith(url);
    instances[0].handlers.get('error')?.('error', { fatal: true, type: 'network' });
    expect(instances[0].destroy).toHaveBeenCalled();
    expect(instances[1].loadSource).toHaveBeenCalledWith('/api/proxy?url=' + encodeURIComponent(url));
    dispose();
  });

  it('restores playback position and saves the final position on cleanup', async () => {
    const video = new FakeVideo();
    const options = { ...opts(), getRestorePosition: async () => 37 };
    const dispose = attach(video, options);
    video.duration = 120;
    video.readyState = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
    await Promise.resolve();
    expect(video.currentTime).toBe(37);
    video.currentTime = 48;
    dispose();
    expect(options.onPause).toHaveBeenCalledWith(48, 120);
  });

  it('cancels a pending restore when the player unmounts', async () => {
    const video = new FakeVideo();
    let resolve!: (position: number) => void;
    const pending = new Promise<number>((done) => { resolve = done; });
    const dispose = attach(video, { ...opts(), getRestorePosition: () => pending });
    video.duration = 120;
    video.readyState = 1;
    video.dispatchEvent(new Event('loadedmetadata'));
    dispose();
    resolve(37);
    await Promise.resolve();
    expect(video.currentTime).toBe(0);
  });

  it('keeps the current position when a playing native stream falls back to the proxy', async () => {
    const video = new FakeVideo();
    const dispose = attach(video);
    video.duration = 300;
    video.readyState = 4;
    video.dispatchEvent(new Event('loadedmetadata'));
    await Promise.resolve();
    video.currentTime = 125;
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('error'));
    video.currentTime = 0;
    video.dispatchEvent(new Event('loadedmetadata'));
    await Promise.resolve();
    expect(video.currentTime).toBe(125);
    dispose();
  });

  it('does not save progress again after ending and removes listeners on cleanup', () => {
    const video = new FakeVideo();
    const options = { ...opts(), onEnded: vi.fn() };
    const dispose = attach(video, options);
    video.duration = 120;
    video.readyState = 4;
    video.dispatchEvent(new Event('ended'));
    dispose();
    video.dispatchEvent(new Event('error'));
    expect(options.onEnded).toHaveBeenCalledOnce();
    expect(options.onPause).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
  });
});
