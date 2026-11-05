import { useEffect, useRef } from 'react';

const prints = ['/campaign-20261105-01.webp', '/campaign-20261105-04.webp', '/campaign-20261105-06.webp'];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function printFrame(progress: number, index: number, reduced = false) {
  const distance = index - progress;
  return {
    y: distance * 78,
    opacity: .52 * (1 - clamp(-distance / 1.1)),
    blur: reduced ? 0 : clamp(-distance) * 9,
  };
}

export function ArchitecturalBackground() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    const main = element?.closest('main');
    if (!element || !main) return;
    const layers = Array.from(element.querySelectorAll<HTMLElement>('.architecture-layer'));
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, previousTime = 0;
    const progress = () => clamp(window.scrollY / Math.max(1, main.offsetHeight - innerHeight)) * 2.1;
    let trail = progress();
    const update = (time: number) => {
      frame = 0;
      const target = progress();
      const elapsed = previousTime ? Math.min(50, time - previousTime) : 16;
      previousTime = time;
      trail += (target - trail) * (1 - Math.exp(-elapsed / 190));
      const wake = Math.min(.28, Math.abs(target - trail) * 2.4);
      layers.forEach((layer, index) => {
        const primary = layer.children[0] as HTMLElement;
        const ghost = layer.children[1] as HTMLElement;
        const current = printFrame(target, index, media.matches);
        const delayed = printFrame(trail, index, media.matches);
        layer.style.visibility = Math.abs(index - target) > 1.4 ? 'hidden' : 'visible';
        primary.style.transform = `translate3d(0,${current.y}svh,0)`;
        primary.style.opacity = String(current.opacity);
        primary.style.filter = `blur(${current.blur}px)`;
        ghost.style.transform = `translate3d(0,${delayed.y}svh,0)`;
        ghost.style.opacity = media.matches ? '0' : String(wake * delayed.opacity);
        ghost.style.filter = `blur(${delayed.blur + 5}px)`;
      });
      if (!media.matches && Math.abs(target - trail) > .0005) frame = requestAnimationFrame(update);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(main);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
    };
  }, []);
  return <div className="architectural-backdrop" ref={root} aria-hidden="true">
    {prints.map((src, index) => <div className="architecture-layer" key={src}>
      <div className="architecture-print" style={{ transform: `translate3d(0,${index * 78}svh,0)` }}><img src={src} alt="" width="2048" height="2048" decoding="async" draggable={false}/></div>
      <div className="architecture-print architecture-echo"><img src={src} alt="" width="2048" height="2048" decoding="async" draggable={false}/></div>
    </div>)}
  </div>;
}
