import {defaultWorkHints,supportsWorkHints,type WorkHints} from './reader-work-hints';
import type { ImmersiveProduct } from './reader-appearance';

export const workAreas = ['更新接口文档','核对项目资料','整理需求文档','分类细则最终版','检查原表'] as const;
const tasks = [...workAreas, '组件库','学习机测试','课件修改','评估准则迭代','日报汇总','整理会议纪要','检查交付清单'] as const;
const editions = ['补充资料','调整方案','校验记录','交付说明','执行清单','版本更新'] as const;

function hash(text:string) {
  let value=2166136261;
  for (let i=0;i<text.length;i++) value=Math.imul(value^text.charCodeAt(i),16777619);
  return value>>>0;
}

export function projectAlias(id:string,candidate?:string,metadata:readonly (string|undefined)[]=[]):string {
  const compact=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{C}]/gu,'');
  const alias=candidate?.trim();
  if (alias) {
    const normalized=compact(alias);
    const leaks=metadata.some(raw=>{
      if (!raw) return false;
      const real=compact(raw);
      return real && (normalized===real || (real.length>=2 && normalized.includes(real)));
    });
    if (normalized && !leaks) return alias;
  }
  return tasks[hash(id)%tasks.length];
}

export function taskAlias(n:number):string {
  const base=tasks[n%tasks.length];
  if (n<tasks.length) return base;
  const block=Math.floor(n/tasks.length)-1;
  const revision=Math.floor(block/editions.length)+1;
  return base+' · '+editions[block%editions.length]+(revision>1?' '+revision:'');
}

// Cotex inserts a deterministic status after the first paragraph, then roughly
// once every five paragraphs. It must never become a selectable reading anchor.
export function showWorkEvent(product:ImmersiveProduct,surface:'web'|'desktop',chapter:number,i:number,options:WorkHints=defaultWorkHints) {
  if (!options.enabled || !supportsWorkHints(product,surface)) return false;
  return i===0 || (i*31+(chapter+1)*17)%11 < 11/options.frequency;
}
