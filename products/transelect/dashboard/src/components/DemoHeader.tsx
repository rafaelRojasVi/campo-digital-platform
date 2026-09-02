// products/transelect/dashboard/src/components/DemoHeader.tsx
export function DemoHeader() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>Campo Digital</strong>
          <span className="brand-client">Transelec</span>
          <span className="brand-subtitle">Estado operativo de PMF y predios (demo)</span>
        </div>
      </div>
    </header>
  )
}
