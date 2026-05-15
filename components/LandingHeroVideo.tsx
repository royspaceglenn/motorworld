import React, { useCallback, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import landingHeroPoster from '../src/assets/landing-hero.png';
import landingHeroVideo from '../src/assets/landing-hero.mp4';

/**
 * Hero background video for the public landing page (autoplay, loop, mute toggle).
 */
export const LandingHeroVideo: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const el = videoRef.current;
      if (el) {
        el.muted = next;
        if (!next) {
          void el.play().catch(() => {});
        }
      }
      return next;
    });
  }, []);

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        className="h-full w-full object-cover object-center"
        src={landingHeroVideo}
        poster={landingHeroPoster}
        autoPlay
        loop
        muted={muted}
        playsInline
        preload="auto"
        aria-label="Motor World automotive services showcase"
      />
      <button
        type="button"
        onClick={toggleMute}
        className="absolute bottom-14 right-3 z-20 flex h-10 w-10 items-center justify-center rounded-sm border border-white/25 bg-black/70 text-white backdrop-blur-sm transition hover:bg-black/90 sm:bottom-16 sm:right-4"
        aria-label={muted ? 'Unmute video' : 'Mute video'}
        aria-pressed={!muted}
      >
        {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
};
