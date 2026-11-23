import { CheckCheck, CodeXml, Database, FileCheck2, FileText, Files, FolderOpen, Globe, Image, Layers, Link2, ListChecks, Pencil, Save, Search, SquareTerminal } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ImmersiveProduct } from './reader-appearance';

type IconProps={size?:number;strokeWidth?:number;className?:string};
type Step = readonly [ComponentType<IconProps>,string];
function GridMark({size=16,...props}:IconProps){return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" {...props}><rect x="3" y="3" width="8" height="8" rx="1.9"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="15" width="6" height="6" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.9"/></svg>;}
function ValidationEye({size=16,...props}:IconProps){return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeLinecap="round" {...props}><path d="M22 9.1C19.7 5.2 16.5 2.8 12 2.8 7.3 2.8 3.5 5.6 1.8 12c1.7 5.8 5.5 9.2 10.2 9.2 4.5 0 7.7-2.7 10-6.3"/><circle cx="12" cy="12" r="4.3"/></svg>;}
function BrowserTool({size=16,...props}:IconProps){return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" {...props}><path d="M5 3h9l5 5v12H5zM14 3v6h5M8 12h8M8 15h5"/><circle cx="18" cy="18" r="3" fill="currentColor"/></svg>;}

const codexSteps: Step[] = [
  [FileText,'读取了文件'],[SquareTerminal,'运行了命令'],[Search,'搜索了文件'],[FolderOpen,'查看了资料目录'],
  [ListChecks,'更新了工作计划'],[FileCheck2,'检查了文档'],[Files,'对比了文件内容'],[Image,'已查看图片'],
  [CodeXml,'检查了内容结构'],[Link2,'核对了引用与记录'],[Save,'已保存工作记录'],[GridMark,'已使用 文档加载了工具运行了命令'],
  [BrowserTool,'已使用 浏览器运行了命令'],[CheckCheck,'已完成内容核验'],
  [Database,'整理了数据索引'],[Pencil,'编辑了文件运行了命令'],[GridMark,'已使用 浏览器和文档加载了工具运行了命令'],
];
const buddySteps: Step[] = [
  [Globe,'收集资料，核对相关记录'],[ValidationEye,'运行校验、修改：工作记录.md'],[FileText,'读取文档，整理相关内容'],
  [Image,'检查图片，核对相关素材'],[SquareTerminal,'运行命令，检查处理结果'],[FolderOpen,'查看文件，核对资料目录'],
  [Search,'搜索资料，补充相关信息'],[ListChecks,'检查任务清单与完成情况'],[CodeXml,'分析内容结构与关联记录'],
  [Layers,'比对资料版本与上下文'],[Database,'整理数据，更新内容索引'],[CheckCheck,'已完成核验，保存工作记录'],
];
const researchSteps: Step[] = [
  [Search,'已检索相关资料'],[FileText,'阅读参考文档'],[Link2,'核对引用来源'],[Layers,'比对关键信息'],
  [Files,'已整理附件'],[Database,'更新资料索引'],[FolderOpen,'查阅工作区文件'],
];
const claudeSteps: Step[] = [
  [FolderOpen,'Read project files'],[FileText,'Read reference notes'],[Search,'Searched the workspace'],
  [Files,'Compared documents'],[ListChecks,'Updated task list'],[SquareTerminal,'Checked output'],
];
const gravitySteps: Step[] = [
  [FolderOpen,'Searched workspace'],[FileText,'Analyzed file'],[CodeXml,'Reviewed changes'],
  [ListChecks,'Updated task list'],[Layers,'Compared revisions'],[CheckCheck,'Verified results'],
];
export default function ReaderWorkEvent({product,chapter,paragraph}:{product:ImmersiveProduct;chapter:number;paragraph:number}) {
  const choices=product==='workbuddy'?buddySteps:product==='doubao'?researchSteps:
    product==='claude'?claudeSteps:product==='antigravity'?gravitySteps:codexSteps;
  const seed=chapter*31+paragraph;
  // Use a multiplier coprime with each list's length, so long sessions vary.
  const multiplier=product==='codex'||product==='workbuddy'?7:11;
  const step=choices[(Math.abs(Math.trunc(seed))*multiplier+1)%choices.length];
  const [Icon,label]=step;
  return <div className="mokuji-work-event" data-product={product} aria-hidden="true">
    <Icon size={15} strokeWidth={1.55} className="mokuji-work-event-symbol"/><span className="mokuji-work-event-label">{label}</span>
  </div>;
}
