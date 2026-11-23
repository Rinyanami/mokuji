import type {ImmersiveProduct,ReaderSurface} from './reader-appearance';

export type WorkHints={enabled:boolean;frequency:number};
const storageKey='mokuji.reader.workHints.v1';
export const defaultWorkHints:WorkHints={enabled:true,frequency:5};
export function supportsWorkHints(product:ImmersiveProduct,surface:ReaderSurface){
  return product!=='vscode' && !(product==='antigravity'&&surface==='desktop');
}
export function readWorkHints():WorkHints {
  try{
    const stored=JSON.parse(localStorage.getItem(storageKey)||'null');
    const frequency=stored?.frequency;
    return {enabled:typeof stored?.enabled==='boolean'?stored.enabled:true,
      frequency:Number.isInteger(frequency)&&frequency>=3&&frequency<=12?frequency:5};
  }catch{return {...defaultWorkHints};}
}
export function saveWorkHints(value:WorkHints){try{localStorage.setItem(storageKey,JSON.stringify(value));}catch{/* The current session retains the preference. */}}
export function WorkHintSettings({value,onChange}:{value:WorkHints;onChange:(next:WorkHints)=>void}){
  return <div className="mokuji-hint-options">
    <label><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/> 插入工作提示行</label>
    {value.enabled&&<label>提示密度 <select aria-label="提示密度" value={value.frequency} onChange={e=>onChange({...value,frequency:Number(e.target.value)})}>
      {Array.from({length:10},(_,i)=>i+3).map(n=><option value={n} key={n}>{n}{n===3?'（较多）':n===5?'（标准）':n===9?'（较少）':n===12?'（最少）':''}</option>)}
    </select></label>}
  </div>;
}

