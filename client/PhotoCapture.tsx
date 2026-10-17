import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw } from 'lucide-react';

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.8;

type Phase = 'starting' | 'live' | 'captured' | 'error';

export interface PhotoCaptureProps {
  /** Receives a `data:image/jpeg;base64,...` string the moment a photo is taken. */
  onCapture: (base64Jpeg: string) => void;
  onError?: (err: Error) => void;
  /** Fired when the user discards the captured photo (Retake / Try again), so the parent can drop it. */
  onRetake?: () => void;
  facingMode?: 'user' | 'environment';
  showFaceGuide?: boolean;
}

function describeCameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was denied. Please allow the camera in Settings, or ask reception for help.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device.';
  }
  if (e instanceof Error && e.message) return e.message;
  return 'The camera could not be started.';
}

export function PhotoCapture({ onCapture, onError, onRetake, facingMode = 'user', showFaceGuide = true }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [still, setStill] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      stopStream();
      setMessage(describeCameraError(e));
      setPhase('error');
      onErrorRef.current?.(e instanceof Error ? e : new Error(String(e)));
    },
    [stopStream],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('The camera is not available here (a secure https connection is required).');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.muted = true; // iPad Safari only autoplays muted, inline video
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setPhase('live');
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        fail(e);
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, attempt, fail, stopStream]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      fail(new Error('The photo could not be captured.'));
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // un-mirrored: only the preview is mirrored
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    stopStream();
    setStill(dataUrl);
    setPhase('captured');
    onCapture(dataUrl);
  };

  const restart = () => {
    onRetake?.();
    setStill(null);
    setMessage(null);
    setPhase('starting');
    setAttempt((n) => n + 1);
  };

  const mirror = facingMode === 'user' ? 'scaleX(-1)' : undefined;
  const buttonClass =
    'inline-flex min-h-16 items-center justify-center gap-3 rounded-full px-10 text-xl font-semibold active:scale-95';

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="relative aspect-[4/3] w-full max-w-3xl overflow-hidden rounded-3xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${phase === 'live' ? '' : 'invisible'}`}
          style={{ transform: mirror }}
        />
        {phase === 'captured' && still && (
          <img src={still} alt="Your photo" className="absolute inset-0 h-full w-full object-cover" style={{ transform: mirror }} />
        )}
        {showFaceGuide && phase === 'live' && (
          <div
            data-testid="face-guide"
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          />
        )}
        {phase === 'starting' && (
          <p className="absolute inset-0 flex items-center justify-center text-xl text-white/80">Starting camera…</p>
        )}
      </div>

      {phase === 'error' && (
        <div role="alert" className="max-w-xl text-center text-xl text-red-600">
          {message}
        </div>
      )}

      {phase === 'live' && (
        <button type="button" onClick={capture} className={`${buttonClass} bg-slate-900 text-white`}>
          <Camera size={28} aria-hidden="true" /> Take photo
        </button>
      )}
      {(phase === 'captured' || phase === 'error') && (
        <button type="button" onClick={restart} className={`${buttonClass} bg-slate-200 text-slate-900`}>
          <RefreshCw size={28} aria-hidden="true" /> {phase === 'error' ? 'Try again' : 'Retake'}
        </button>
      )}
    </div>
  );
}
