import { PanelLeft, FolderTree, BarChart3, Settings } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'

export default function Sidebar() {
  const leftPanelVisible = useAppStore((s) => s.leftPanelVisible)
  const leftPanelTab = useAppStore((s) => s.leftPanelTab)
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel)
  const setLeftPanelTab = useAppStore((s) => s.setLeftPanelTab)
  const setShowSettings = useAppStore((s) => s.setShowSettings)

  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <button
          className={`sidebar-btn ${leftPanelVisible ? 'active' : ''}`}
          onClick={toggleLeftPanel}
          title={`${leftPanelVisible ? '隐藏' : '显示'}左侧面板 (⌘B)`}
        >
          <PanelLeft size={20} />
        </button>

        <div className="sidebar-divider" />

        <button
          className={`sidebar-btn ${leftPanelVisible && leftPanelTab === 'tree' ? 'active' : ''}`}
          onClick={() => setLeftPanelTab('tree')}
          title="发票分类"
        >
          <FolderTree size={20} />
        </button>

        <button
          className={`sidebar-btn ${leftPanelVisible && leftPanelTab === 'statistics' ? 'active' : ''}`}
          onClick={() => setLeftPanelTab('statistics')}
          title="金额统计"
        >
          <BarChart3 size={20} />
        </button>
      </div>
      <div className="sidebar-bottom">
        <button
          className="sidebar-btn"
          onClick={() => setShowSettings(true)}
          title="系统设置"
        >
          <Settings size={22} />
        </button>
      </div>
    </div>
  )
}
