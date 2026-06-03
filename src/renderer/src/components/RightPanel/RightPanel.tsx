import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import type { RightPanelMode } from '../../types/invoice'
import InvoiceDetail from './InvoiceDetail'
import EmailPanel from './EmailPanel'
import PrintQueue from './PrintQueue'

const tabs: { mode: RightPanelMode; label: string; emoji: string }[] = [
  { mode: 'email', label: '邮箱', emoji: '📧' },
  { mode: 'detail', label: '详情', emoji: '📄' },
  { mode: 'print', label: '打印', emoji: '🖨️' }
]

export default function RightPanel() {
  const rightPanelVisible = useAppStore((s) => s.rightPanelVisible)
  const rightPanelMode = useAppStore((s) => s.rightPanelMode)
  const setRightPanelMode = useAppStore((s) => s.setRightPanelMode)
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel)

  return (
    <div className="right-panel" style={{ display: rightPanelVisible ? 'flex' : 'none' }}>
      <div className="right-panel-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.mode}
            className={`right-panel-tab ${rightPanelMode === tab.mode ? 'active' : ''}`}
            onClick={() => setRightPanelMode(tab.mode)}
          >
            <span>{tab.emoji}</span>
            <span>{tab.label}</span>
          </button>
        ))}
        <button className="right-panel-close" onClick={toggleRightPanel} title="隐藏右侧面板 (⌘J)">
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="right-panel-content">
        <div style={{ display: rightPanelMode === 'email' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <EmailPanel />
        </div>
        <div style={{ display: rightPanelMode === 'detail' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <InvoiceDetail />
        </div>
        <div style={{ display: rightPanelMode === 'print' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <PrintQueue />
        </div>
      </div>
    </div>
  )
}
