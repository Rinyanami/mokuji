import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, File, X } from 'lucide-react';
import './reader-work-summary.css';

// Modelled on Cotex's local WorkSummary. These previews contain only static
// project notes; they never incorporate the selected book or its contents.
const topics = ['接口文档', '资料整理', '项目核对', '内容检查'] as const;

function buildAttachments(seed = 0) {
  const topic = topics[Math.abs(Math.trunc(seed)) % topics.length];
  return [
    {
      name: `${topic}核对简报.pdf`,
      kind: 'PDF' as const,
      title: `${topic}核对简报`,
      lead: '已整理当前资料，完成结构检查、记录核对与交接内容汇总。',
      sections: [
        ['核对范围', '核对接口清单与文档里的字段名、类型和必填项，单独记录了命名不一致的地方。'],
        ['变更记录', '参数表与返回示例采用相同的字段顺序。历史别名保留在备注列，方便查找旧记录。'],
        ['待复核', '下次联调时补齐空值、缺省值和重试后的返回示例。'],
      ],
    },
    {
      name: `${topic}交接说明.txt`,
      kind: 'TXT' as const,
      title: `${topic}交接说明`,
      lead: '当前工作结果已整理，可按以下顺序继续处理。',
      sections: [
        ['查找记录', '从工作索引进入对应模块，先看字段说明，再看本次修订的备注。'],
        ['维护示例', '调整参数时同步核对请求和响应示例，记录变更日期与原因。'],
        ['下次核对', '将仍待确认的条目留在复核清单中，联调结束后补充结果。'],
      ],
    },
  ];
}

function SummaryFileIcon({ kind, size = 17 }: { kind: 'PDF' | 'TXT'; size?: number }) {
  if (kind !== 'PDF') return <File size={size} strokeWidth={1.8} aria-hidden="true" />;
  return (
    <svg className="work-brief-pdf-icon" width={size} height={size} viewBox="0 0 20 24" aria-hidden="true">
      <path fill="#ff5661" d="M4 0h8l8 8v12a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4Z" />
      <path fill="#ff9ca3" d="M12 0v6a2 2 0 0 0 2 2h6Z" />
      <text x="10" y="19" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="700" fontFamily="Arial,sans-serif">
        PDF
      </text>
    </svg>
  );
}

export function ReaderWorkSummary({ seed = 0, onResume }: { seed?: number; onResume: () => void }) {
  const attachments = buildAttachments(seed);
  const [preview, setPreview] = useState<(typeof attachments)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!preview || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, [preview]);

  return (
    <section className="work-brief" aria-label="工作摘要">
      <div className="work-brief-page">
        <div className="work-brief-status">
          <span className="work-brief-dot" />
          <span>已完成结构核对与记录整理</span>
        </div>
        <h2>{topics[Math.abs(Math.trunc(seed)) % topics.length]}更新摘要</h2>
        <p>
          已完成这部分资料的整理，<strong>交接简报与工作记录</strong>已汇总，内容结构和相关条目已核对。
        </p>
        <div className="work-brief-files" aria-label="工作摘要附件">
          {attachments.map(file => (
            <button key={file.name} type="button" onClick={() => setPreview(file)} aria-label={'预览 ' + file.name}>
              <SummaryFileIcon kind={file.kind} />
              <span>{file.name}</span>
            </button>
          ))}
        </div>
        <p>可结合简报和交接说明继续核对，按同一标准补齐后续记录。</p>
        <ul>
          <li>统一请求参数和响应示例中的字段名称。</li>
          <li>补上必填项、默认值和异常返回的说明。</li>
          <li>保留有效记录并同步当前位置，待联调项单独列入复核清单。</li>
        </ul>
        <button type="button" className="work-brief-return" onClick={onResume}>
          <ArrowLeft size={14} />
          <span>返回工作记录</span>
          <kbd>Space</kbd>
        </button>
      </div>
      {preview && (
        <dialog
          ref={dialog}
          className="work-brief-dialog"
          aria-labelledby="work-brief-filename"
          onCancel={event => { event.preventDefault(); setPreview(null); }}
          onClick={event => { if (event.target === event.currentTarget) setPreview(null); }}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPreview(null); }
            else if (event.code === 'Space') event.stopPropagation();
          }}
        >
          <header>
            <div className="work-brief-dialog-title">
              <SummaryFileIcon kind={preview.kind} size={19} />
              <strong id="work-brief-filename">{preview.name}</strong>
            </div>
            <button type="button" aria-label="关闭预览" onClick={() => setPreview(null)}>
              <X size={17} />
            </button>
          </header>
          <div className="work-brief-paper">
            <h2>{preview.title}</h2>
            <p className="work-brief-lead">{preview.lead}</p>
            {preview.sections.map(([title, body]) => (
              <section key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </section>
            ))}
          </div>
          <footer>
            <button type="button" className="work-brief-close-btn" onClick={() => setPreview(null)}>
              返回工作摘要
            </button>
          </footer>
        </dialog>
      )}
    </section>
  );
}
