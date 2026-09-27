import { useEffect } from 'react';
import { Monitor, Moon, Sun, X, Zap } from 'lucide-react';
import { APP_NAME, STATUS_LABEL, STATUS_TONE, TAGLINE } from './lib/format';
import { useTheme } from './lib/theme';

export function BrandMark({ showTagline = true }) {
  const [first, ...rest] = APP_NAME.split(' ');
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden><Zap size={22} strokeWidth={2.2} /></div>
      <div>
        <div className="brand-name">{first} <span>{rest.join(' ')}</span></div>
        {showTagline && <div className="brand-tagline">{TAGLINE}</div>}
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <button type="button" className="ghost" onClick={cycle} title={'Theme: ' + theme} aria-label={'Theme: ' + theme + '. Click to change.'}>
      <Icon size={18} />
    </button>
  );
}

export function Info({ a, b }) {
  return <div className="info"><span>{a}</span><strong>{b}</strong></div>;
}

export function StatusPill({ status }) {
  return <span className={'pill ' + (STATUS_TONE[status] || '')}>{STATUS_LABEL[status] || status}</span>;
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="ghost" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}
