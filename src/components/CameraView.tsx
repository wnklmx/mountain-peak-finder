import { useEffect, useRef, useState } from 'react';
import Panorama, { type PanoramaProps } from './Panorama';

type CamStatus = 'starting' | 'live' | 'denied' | 'unsupported' | 'error';

interface Props extends PanoramaProps {
  onExit: () => void;
  /** Horizontal field of view of the raw camera frame, in degrees. */
  cameraFov: number;
  onCameraFov: (value: number) => void;
}

/**
 * Live rear camera with the skyline and labels drawn on top.
 *
 * The camera's true field of view is unknown and differs per phone, so the
 * overlay is scaled twice: once for the raw lens (a setting) and once for the
 * part of the frame that `object-fit: cover` actually shows in this window.
 */
export default function CameraView({ onExit, cameraFov, onCameraFov, ...panorama }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<CamStatus>('starting');
  const [message, setMessage] = useState('');
  const [frame, setFrame] = useState({ w: 4, h: 3 });
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setBox({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let timer: number | undefined;

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setMessage('This browser cannot open the camera.');
      return;
    }

    setStatus('starting');
    timer = window.setTimeout(() => {
      if (cancelled || stream) return;
      setStatus('error');
      setMessage('The camera did not respond. Close other apps using it and try again.');
    }, 9000);

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      })
      .then((next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        const track = next.getVideoTracks()[0];
        const settings = track?.getSettings();
        if (settings?.width && settings?.height) {
          setFrame({ w: settings.width, h: settings.height });
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = next;
          void video.play().catch(() => undefined);
        }
        setStatus('live');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied');
          setMessage('Camera access was refused. Allow it in the browser site settings and reload.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('error');
          setMessage('No rear camera was found on this device.');
        } else {
          setStatus('error');
          setMessage(error instanceof Error ? error.message : 'The camera could not be opened.');
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  // `object-fit: cover` crops whichever axis is proportionally longer, so the
  // overlay must be told how much of the frame is really on screen.
  const containerAspect = box.w && box.h ? box.w / box.h : 0;
  const frameAspect = frame.w / frame.h;
  const visibleFraction = containerAspect ? Math.min(1, containerAspect / frameAspect) : 1;
  // Only the live frame is cropped by `object-fit: cover`; until it arrives the
  // window still shows the whole nominal field of view.
  const effectiveFov =
    status === 'live' ? Math.max(18, Math.min(120, cameraFov * visibleFraction)) : cameraFov;

  return (
    <div className="camera-view" ref={hostRef}>
      <video ref={videoRef} className="camera-video" autoPlay playsInline muted />

      {status !== 'live' ? (
        <div className="camera-fallback">
          <p>{status === 'starting' ? 'Opening the camera…' : message}</p>
          <button className="secondary" onClick={onExit}>
            Back to the panorama
          </button>
        </div>
      ) : null}
      <Panorama {...panorama} camera fov={effectiveFov} />

      <div className="camera-controls">
        <button className="cam-pill" onClick={onExit}>
          Exit
        </button>
        <div className="cam-fov">
          <span>FOV {Math.round(cameraFov)}°</span>
          <button onClick={() => onCameraFov(Math.max(35, cameraFov - 2))} aria-label="Narrow the field of view">
            −
          </button>
          <button onClick={() => onCameraFov(Math.min(110, cameraFov + 2))} aria-label="Widen the field of view">
            +
          </button>
        </div>
      </div>
    </div>
  );
}
