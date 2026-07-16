import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createLiquidGlassMap } from './liquid-glass-map';

let filterSequence = 0;

function mapToBlobUrl() {
  const map = createLiquidGlassMap();
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve<string | undefined>(undefined);
  context.putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
  return new Promise<string | undefined>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : undefined), 'image/png');
  });
}

export function LiquidGlassRuntime() {
  const [mapUrl, setMapUrl] = useState<string>();
  const [filterBase] = useState(() => `liquid-glass-${++filterSequence}`);
  const [singlePass] = useState(() => {
    const userAgent = navigator.userAgent;
    const isAndroidWebView = /android/i.test(userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);

    // High-DPI Android WebViews can exhaust Chromium's tile-memory budget when
    // the same refracted backdrop is rendered in three color-channel passes.
    // A single optical pass keeps the lens distortion while avoiding blank
    // compositor frames on foldable inner and outer displays.
    return isAndroidWebView || isSafari;
  });
  const [revision, setRevision] = useState(0);
  const filterId = `${filterBase}-${revision}`;

  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void mapToBlobUrl().then((nextUrl) => {
      url = nextUrl;
      if (active) setMapUrl(nextUrl);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!mapUrl) return;
    const root = document.documentElement;
    root.classList.add('liquid-glass-ready');
    root.style.setProperty('--liquid-glass-filter', `url(#${filterId})`);
    return () => {
      root.classList.remove('liquid-glass-ready');
      root.style.removeProperty('--liquid-glass-filter');
    };
  }, [filterId, mapUrl]);

  useEffect(() => {
    const rebuild = () => setRevision((current) => current + 1);
    window.addEventListener('liquid-glass:rebuild', rebuild);
    return () => {
      window.removeEventListener('liquid-glass:rebuild', rebuild);
    };
  }, []);

  if (!mapUrl) return null;
  return <svg className="liquid-glass-defs" aria-hidden="true" focusable="false">
    <defs>
      <filter id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feFlood floodColor="rgb(128,128,128)" floodOpacity="1" result="map-bg" />
        <feImage href={mapUrl} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="raw-map" />
        <feComposite in="raw-map" in2="map-bg" operator="over" result="map" />
        {singlePass ? <feDisplacementMap in="SourceGraphic" in2="map" scale="20.16" xChannelSelector="R" yChannelSelector="G" result="lens-color" /> : <>
          <feDisplacementMap in="SourceGraphic" in2="map" scale="21.12" xChannelSelector="R" yChannelSelector="G" result="pass-r" />
          <feColorMatrix in="pass-r" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="20.16" xChannelSelector="R" yChannelSelector="G" result="pass-g" />
          <feColorMatrix in="pass-g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="19.2" xChannelSelector="R" yChannelSelector="G" result="pass-b" />
          <feColorMatrix in="pass-b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
          <feComposite in="red" in2="green" operator="arithmetic" k2="1" k3="1" result="red-green" />
          <feComposite in="red-green" in2="blue" operator="arithmetic" k2="1" k3="1" result="lens-color" />
        </>}
        <feColorMatrix in="map" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5019607843" result="specular-mask" />
        <feComposite in="specular-mask" in2="lens-color" operator="arithmetic" k2="1" k3="1" result="lens-result" />
        <feGaussianBlur in="lens-result" stdDeviation="0.5" />
      </filter>
    </defs>
  </svg>;
}

type CopyStyle = CSSProperties & { width: string; height: string; transform: string };

export function CounterPositionedGlassImage({
  sceneRef,
  src,
  className = '',
  children,
}: {
  sceneRef: RefObject<HTMLElement | null>;
  src?: string;
  className?: string;
  children: ReactNode;
}) {
  const lensRef = useRef<HTMLDivElement>(null);
  const [copyStyle, setCopyStyle] = useState<CopyStyle>({ width: '100%', height: '100%', transform: 'none' });

  useEffect(() => {
    const scene = sceneRef.current;
    const lens = lensRef.current;
    if (!scene || !lens) return;
    let previousSize = '';
    const update = () => {
      const sceneRect = scene.getBoundingClientRect();
      const lensRect = lens.getBoundingClientRect();
      setCopyStyle({
        width: `${sceneRect.width}px`,
        height: `${sceneRect.height}px`,
        transform: `translate3d(${sceneRect.left - lensRect.left}px,${sceneRect.top - lensRect.top}px,0)`,
      });
      const nextSize = `${Math.round(lensRect.width)}x${Math.round(lensRect.height)}`;
      if (previousSize && previousSize !== nextSize) window.dispatchEvent(new Event('liquid-glass:rebuild'));
      previousSize = nextSize;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scene);
    observer.observe(lens);
    window.addEventListener('resize', update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [sceneRef]);

  useEffect(() => {
    window.dispatchEvent(new Event('liquid-glass:rebuild'));
  }, [src]);

  return <div ref={lensRef} className={`true-glass-lens ${className}`}>
    {src ? <div className="true-glass-refraction" aria-hidden="true"><div style={copyStyle}><img src={src} alt="" referrerPolicy="no-referrer" /></div></div> : null}
    <div className="true-glass-contrast" aria-hidden="true" />
    <div className="true-glass-content">{children}</div>
  </div>;
}
