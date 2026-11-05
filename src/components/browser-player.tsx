'use client';

import { useEffect, useRef, useState } from 'react';
import { attachBrowserPlayback } from '@/lib/browser-player';
import type { PlayerShellProps } from './player-shell';

export function BrowserPlayer(props: PlayerShellProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.url) return;
    setHint('');
    // Capture this episode's callbacks so cleanup cannot save progress to a new episode.
    const current = propsRef.current;
    return attachBrowserPlayback(video, current.url, {
      userAgent: navigator.userAgent,
      adFilter: current.adFilter,
      getRestorePosition: current.getRestorePosition,
      onProgress: current.onTimeUpdate,
      onPause: current.onPause,
      onEnded: current.onEnded,
      onError: setError,
      onHint: setHint,
    });
  }, [props.url, props.episodeKey, props.adFilter, retry]);

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        autoPlay
        playsInline
        preload="metadata"
        poster="/player-poster.png"
        aria-label={props.title}
      />
      {hint && !error && (
        <div className="absolute top-3 inset-x-3 text-center text-sm text-white pointer-events-none">
          <span className="bg-black/70 rounded px-3 py-1">{hint}</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4">
          <p className="text-danger text-sm text-center">{error}</p>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>重试播放</button>
            <button className="btn-ghost btn-sm" onClick={() => props.onRequestSwitchSource?.('当前视频播放失败')}>切换资源</button>
          </div>
        </div>
      )}
    </div>
  );
}
