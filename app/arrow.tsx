export function Arrow({ direction = 'ne' }: { direction?: 'ne' | 'up' | 'down' | 'right' }) {
  const angle = { ne: -45, up: -90, down: 90, right: 0 }[direction];
  return <svg className="ui-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 12h17M13 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" transform={`rotate(${angle} 12 12)`}/>
  </svg>;
}

// SVG paths do not switch to emoji glyphs on iOS or Android.
export function inlineArrows(text: string) {
  const directions = { '↗': 'ne', '↑': 'up', '↓': 'down', '→': 'right' } as const;
  return text.replace(/\\n/g, '\n').split(/([↗↑↓→])/).map((part, i) =>
    part in directions ? <Arrow key={i} direction={directions[part as keyof typeof directions]}/> : part,
  );
}
