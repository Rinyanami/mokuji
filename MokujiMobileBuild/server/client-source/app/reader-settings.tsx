import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  children: ReactNode;
  onClose: () => void;
};

export default function ReaderSettings({children, onClose}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus({preventScroll:true}); };
  }, []);
  return <dialog ref={ref} className="mokuji-reader-settings" aria-labelledby="mokuji-settings-heading"
    onCancel={event=>{event.preventDefault(); onClose();}}
    onClick={event=>{
      if (event.target !== event.currentTarget) return;
      const r=event.currentTarget.getBoundingClientRect();
      if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) onClose();
    }}>
    <div className="mokuji-settings-title"><h2 id="mokuji-settings-heading">阅读设置</h2>
      <button type="button" onClick={onClose} aria-label="关闭阅读设置" autoFocus><X size={18}/></button></div>
    {children}
  </dialog>;
}
