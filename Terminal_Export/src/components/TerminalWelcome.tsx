import { X } from 'lucide-react';

/** A brief, nonmodal welcome; the terminal is already mounted and usable below. */
export default function TerminalWelcome({name, onDismiss}: {name: string; onDismiss: () => void}) {
  return <aside className="terminal-welcome-wrap" aria-label="Bienvenida a la terminal">
    <div className="terminal-welcome-panel">
      <div className="terminal-welcome-accent" aria-hidden="true"/>
      <div role="status" aria-live="polite" className="min-w-0 py-5 pl-5 pr-3 sm:pl-6">
        <p className="mb-1.5 flex items-center gap-2 text-[10px] font-medium tracking-[0.18em] text-slate-400">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400"/>TERMINAL
        </p>
        <p className="break-words text-lg font-semibold leading-snug tracking-tight text-slate-100 sm:text-xl">
          Bienvenido{name ? `, ${name}` : ''}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">Tu espacio de mercado está listo.</p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Omitir bienvenida"
        className="mr-3 mt-3 self-start rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
        <X size={15} aria-hidden="true"/>
      </button>
    </div>
  </aside>;
}
