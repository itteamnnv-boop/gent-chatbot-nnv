export default function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}
