import Hls from 'hls.js';
import { createHlsLoader } from './hls-loader';
import { isProxiedUri } from './m3u8';

interface BrowserPlaybackOptions {
  userAgent: string;
  adFilter: boolean;
  getRestorePosition?: () => Promise<number> | number;
  onProgress?: (position: number, duration: number) => void;
  onPause?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onError: (message: string) => void;
  onHint: (message: string) => void;
}

/** Keep a real media URL on browsers that can take over playback, including Quark. */
export function attachBrowserPlayback(video: HTMLVideoElement, url: string, options: BrowserPlaybackOptions) {
  let hls: Hls | null = null;
  let disposed = false;
  let ended = false;
  let started = false;
  let restored = false;
  let restoring = false;
  let resumePosition: number | undefined;
  let generation = 0;
  let currentUrl = url;
  let engine: 'native' | 'hls' = 'native';
  let lastSave = 0;
  let mediaRecoveries = 0;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners: Array<[string, EventListener]> = [];
  const bridgeSupported = Hls.isSupported();
  const nativePreferred = /\bQuark\b/i.test(options.userAgent) ||
    !!video.canPlayType('application/vnd.apple.mpegurl') ||
    !!video.canPlayType('application/x-mpegURL') || !bridgeSupported;
  const isHls = !/\.(?:mp4|m4v|webm|ogv|ogg|mov)(?:[?#]|$)/i.test(url);
  const proxied = (target: string) => isProxiedUri(target) ||
    (() => {
      try { const u = new URL(target, document.baseURI); return u.origin === location.origin && isProxiedUri(u.pathname); }
      catch { return false; }
    })();
  const proxyUrl = () => `/api/proxy?url=${encodeURIComponent(url)}`;
  const clearStartupTimer = () => { clearTimeout(startupTimer); startupTimer = undefined; };
  const play = () => { void video.play().catch(() => {}); };
  const fail = () => {
    clearStartupTimer();
    options.onError('视频播放失败，请切换视频源或改用网页播放器');
  };

  const restorePosition = async () => {
    if (restored || restoring || disposed || !Number.isFinite(video.duration) || video.duration <= 0) return;
    restoring = true;
    const activeGeneration = generation;
    try {
      const position = resumePosition ?? (await options.getRestorePosition?.()) ?? 0;
      if (disposed || generation !== activeGeneration) return;
      if (Number.isFinite(position) && position > 0 && position < video.duration - 2) video.currentTime = position;
      restored = true;
      resumePosition = undefined;
    } catch { /* A missing local progress record must not prevent playback. */ }
    finally { restoring = false; }
  };

  const save = (paused = false) => {
    if (ended || video.readyState === 0 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    if (paused) options.onPause?.(video.currentTime, video.duration);
    else options.onProgress?.(video.currentTime, video.duration);
  };

  const connect = (target: string, useNative: boolean) => {
    clearStartupTimer();
    if (started && video.readyState > 0 && video.currentTime > 0) {
      resumePosition = video.currentTime;
      restored = false;
    }
    generation++;
    hls?.destroy();
    hls = null;
    currentUrl = target;
    engine = useNative ? 'native' : 'hls';
    video.dataset.playbackEngine = engine;
    options.onError('');
    if (useNative) {
      // No crossorigin requirement or JS blob URL: the browser owns HLS fetching.
      video.removeAttribute('crossorigin');
      video.src = target;
      video.load();
      play();
      return;
    }
    const instance = new Hls({
      enableWorker: true,
      backBufferLength: 90,
      maxBufferLength: 30,
      fragLoadingMaxRetry: 1,
      manifestLoadingMaxRetry: 1,
      loader: createHlsLoader(Hls, { blockAd: options.adFilter }),
    });
    hls = instance;
    instance.on(Hls.Events.MANIFEST_PARSED, play);
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (disposed || hls !== instance || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !proxied(target)) {
        options.onHint('正在切换播放线路…');
        connect(proxyUrl(), false);
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 2) {
        instance.recoverMediaError();
      } else fail();
    });
    instance.loadSource(target);
    instance.attachMedia(video);
  };

  const nativeError = () => {
    if (disposed || engine !== 'native') return;
    if (!proxied(currentUrl)) {
      options.onHint('正在切换播放线路…');
      connect(proxyUrl(), true);
    } else if (isHls && bridgeSupported) {
      options.onHint('正在兼容当前视频格式…');
      connect(currentUrl, false);
    } else fail();
  };
  const armStartupTimer = () => {
    if (started || engine !== 'native' || startupTimer || video.paused || video.readyState > 0) return;
    startupTimer = setTimeout(() => {
      startupTimer = undefined;
      if (!disposed && !started && !video.paused && video.readyState === 0) nativeError();
    }, 12000);
  };
  const on = (name: string, listener: EventListener) => {
    listeners.push([name, listener]);
    video.addEventListener(name, listener);
  };
  on('error', nativeError);
  on('play', armStartupTimer);
  on('waiting', armStartupTimer);
  on('loadedmetadata', () => { clearStartupTimer(); void restorePosition(); });
  on('durationchange', () => { void restorePosition(); });
  on('playing', () => {
    started = true;
    clearStartupTimer();
    options.onError('');
    options.onHint('');
  });
  on('timeupdate', () => {
    if (Date.now() - lastSave >= 5000) { lastSave = Date.now(); save(); }
  });
  on('pause', () => { clearStartupTimer(); save(true); });
  on('ended', () => { ended = true; options.onEnded?.(); });
  const saveOnHide = () => { if (document.visibilityState === 'hidden') save(true); };
  document.addEventListener('visibilitychange', saveOnHide);

  video.controls = true;
  video.disableRemotePlayback = false;
  connect(url, !isHls || nativePreferred);

  return () => {
    disposed = true;
    clearStartupTimer();
    save(true);
    for (const [name, listener] of listeners) video.removeEventListener(name, listener);
    document.removeEventListener('visibilitychange', saveOnHide);
    hls?.destroy();
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
}
