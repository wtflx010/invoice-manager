import { useRef, useEffect } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { PanelRightOpen } from 'lucide-react'
import { useAppStore } from './stores/appStore'
import { useInvoiceStore } from './stores/invoiceStore'
import Sidebar from './components/Sidebar/Sidebar'
import InvoiceTree from './components/InvoiceTree/InvoiceTree'
import StatisticsView from './components/Statistics/StatisticsView'
import ChatPanel from './components/ChatPanel/ChatPanel'
import RightPanel from './components/RightPanel/RightPanel'
import ToastContainer from './components/Toast/Toast'
import SettingsModal from './components/SettingsModal/SettingsModal'
import appIcon from './assets/icon.png'

export default function App() {
  const leftPanelVisible = useAppStore((s) => s.leftPanelVisible)
  const leftPanelTab = useAppStore((s) => s.leftPanelTab)
  const rightPanelVisible = useAppStore((s) => s.rightPanelVisible)
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel)

  const leftPanelRef = useRef<import('react-resizable-panels').ImperativePanelHandle>(null)
  const rightPanelRef = useRef<import('react-resizable-panels').ImperativePanelHandle>(null)

  // Sync store -> panel: resize panels when store visibility changes
  useEffect(() => {
    const panel = leftPanelRef.current
    if (!panel) return
    if (leftPanelVisible) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [leftPanelVisible])

  useEffect(() => {
    const panel = rightPanelRef.current
    if (!panel) return
    if (rightPanelVisible) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [rightPanelVisible])

  useEffect(() => {
    useAppStore.getState().initialize()
    useInvoiceStore.getState().initialize()

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'b') {
        e.preventDefault()
        useAppStore.getState().toggleLeftPanel()
      }
      if (mod && e.key === 'j') {
        e.preventDefault()
        useAppStore.getState().toggleRightPanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="app-container">
      <div className="titlebar">
        <img src={appIcon} className="titlebar-icon" alt="icon" />
        <span className="titlebar-title">发票管理助手</span>
      </div>
      <div className="main-content">
        <Sidebar />
        <ToastContainer />
        <SettingsModal />

        <PanelGroup direction="horizontal" style={{ flex: 1 }}>
          <Panel
            ref={leftPanelRef}
            defaultSize={18}
            minSize={0}
            collapsible
            collapsedSize={0}
            onCollapse={() => {
              if (useAppStore.getState().leftPanelVisible) {
                useAppStore.getState().toggleLeftPanel()
              }
            }}
            onExpand={() => {
              if (!useAppStore.getState().leftPanelVisible) {
                useAppStore.getState().toggleLeftPanel()
              }
            }}
          >
            <div className="panel-left">
              {leftPanelTab === 'tree' ? <InvoiceTree /> : <StatisticsView />}
            </div>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={62} minSize={5}>
            <div className="panel-center" style={{ position: 'relative' }}>
              <ChatPanel />
              {!rightPanelVisible && (
                <button
                  onClick={toggleRightPanel}
                  title="显示右侧面板 (⌘J)"
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface0)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--fg-overlay0)',
                    cursor: 'pointer',
                    zIndex: 10,
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--fg-text)'
                    e.currentTarget.style.background = 'var(--bg-surface1)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--fg-overlay0)'
                    e.currentTarget.style.background = 'var(--bg-surface0)'
                  }}
                >
                  <PanelRightOpen size={14} />
                </button>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel
            ref={rightPanelRef}
            defaultSize={20}
            minSize={0}
            collapsible
            collapsedSize={0}
            onCollapse={() => {
              if (useAppStore.getState().rightPanelVisible) {
                useAppStore.getState().toggleRightPanel()
              }
            }}
            onExpand={() => {
              if (!useAppStore.getState().rightPanelVisible) {
                useAppStore.getState().toggleRightPanel()
              }
            }}
          >
            <div className="panel-right">
              <RightPanel />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
