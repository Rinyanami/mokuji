import { Eye, EyeOff } from 'lucide-react';
import './reader-shell-peek.css';

export function PeekText({
  mask,
  real,
}: {
  mask: string;
  real?: string;
}) {
  const cleanReal = real?.trim();
  if (!cleanReal || cleanReal === mask) {
    return <span className="mk-peek-single">{mask}</span>;
  }
  return (
    <span className="mk-peek">
      <span className="mk-peek-mask">{mask}</span>
      <span className="mk-peek-real">{cleanReal}</span>
    </span>
  );
}

export function RevealToggle({
  active,
  onToggle,
  label,
}: {
  active: boolean;
  onToggle?: () => void;
  label?: string;
}) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      className={'mk-reveal-btn' + (active ? ' is-on' : '')}
      aria-pressed={active}
      title={active ? '恢复工作伪装名 (Alt+V)' : '悬停可看单行，点击或按 Alt+V 整栏显真名'}
      onClick={e => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {active ? <EyeOff size={13} /> : <Eye size={13} />}
      {label && <span>{label}</span>}
    </button>
  );
}
