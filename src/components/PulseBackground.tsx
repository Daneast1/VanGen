import { useMemo } from 'react';

interface Props {
  hashrate: number;
  network: 'btc' | 'eth';
}

export default function PulseBackground({ hashrate, network }: Props) {
  const speed = useMemo(() => {
    if (hashrate === 0) return 4;
    if (hashrate < 100) return 3;
    if (hashrate < 500) return 2;
    return 1;
  }, [hashrate]);

  const color = network === 'btc' ? 'var(--mint)' : 'var(--blue)';

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {[0.8, 1.2, 1.6].map((scale, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${scale * 600}px`,
            height: `${scale * 600}px`,
            left: '50%',
            top: '40%',
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, hsl(${color} / 0.08) 0%, transparent 70%)`,
            animation: `pulse-ring ${speed + i * 0.5}s ease-in-out infinite`,
            animationDelay: `${i * 0.3}s`,
          }}
        />
      ))}
    </div>
  );
}
