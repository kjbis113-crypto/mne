import {useEffect, useRef, useState} from 'react';

const poster = '/campaign-20261105-07.webp';

export function HeroFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const film = video.current;
    if (!film) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      film.muted = true;
      film.autoplay = !preference.matches;
      if (preference.matches) film.pause();
      else void film.play().catch(() => {});
    };
    syncPreference();
    preference.addEventListener('change', syncPreference);
    return () => {
      preference.removeEventListener('change', syncPreference);
      film.pause();
    };
  }, []);

  const togglePlayback = () => {
    const film = video.current;
    if (!film) return;
    if (film.paused) void film.play().catch(() => {});
    else film.pause();
  };

  if (failed) return <img className="hero-photograph" src={poster} alt="바위 위에 놓인 은색 MNÉ 향초"/>;

  return <>
    <video
      ref={video}
      className="hero-photograph"
      src="/mne-hero-focus-loop-20261105.mp4"
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-label="초점이 흐려졌다 선명해지는 MNÉ 향초 영상"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onError={() => setFailed(true)}
    />
    <button
      type="button"
      className="hero-film-toggle"
      onClick={togglePlayback}
      aria-label={playing ? '배경 영상 일시정지' : '배경 영상 재생'}
      title={playing ? '영상 일시정지' : '영상 재생'}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {playing ? <path d="M7 5h3v14H7zm7 0h3v14h-3z"/> : <path d="m8 5 11 7-11 7z"/>}
      </svg>
    </button>
  </>;
}
