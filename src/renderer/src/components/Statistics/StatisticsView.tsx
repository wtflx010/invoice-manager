import { useState, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useInvoiceStore } from '../../stores/invoiceStore'
import { useAppStore } from '../../stores/appStore'
import { getCategoryColor, getCategoryIcon } from '../../utils/classificationRules'

interface PeriodGroup {
  label: string
  count: number
  totalAmount: number
}

export default function StatisticsView() {
  const getStatistics = useInvoiceStore((s) => s.getStatistics)
  const setFilterCategory = useAppStore((s) => s.setFilterCategory)
  const setLeftPanelTab = useAppStore((s) => s.setLeftPanelTab)
  const leftPanelVisible = useAppStore((s) => s.leftPanelVisible)
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel)
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month')

  const stats = getStatistics()
  const now = new Date()

  const formatAmount = (amount: number) =>
    amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const periodGroups = useMemo<PeriodGroup[]>(() => {
    if (period === 'month') {
      return stats.byMonth.map((m) => ({
        label: m.month,
        count: m.count,
        totalAmount: m.totalAmount
      }))
    }

    if (period === 'quarter') {
      const quarterMap = new Map<string, PeriodGroup>()
      for (const m of stats.byMonth) {
        const [yearStr, monthStr] = m.month.split('-')
        const year = parseInt(yearStr, 10)
        const month = parseInt(monthStr, 10)
        const q = Math.ceil(month / 3)
        const key = `${year}-Q${q}`
        if (!quarterMap.has(key)) {
          quarterMap.set(key, { label: `${year} Q${q}`, count: 0, totalAmount: 0 })
        }
        const group = quarterMap.get(key)!
        group.count += m.count
        group.totalAmount += m.totalAmount
      }
      return Array.from(quarterMap.values()).sort((a, b) => a.label.localeCompare(b.label))
    }

    const yearMap = new Map<string, PeriodGroup>()
    for (const m of stats.byMonth) {
      const year = m.month.split('-')[0]
      if (!yearMap.has(year)) {
        yearMap.set(year, { label: year, count: 0, totalAmount: 0 })
      }
      const group = yearMap.get(year)!
      group.count += m.count
      group.totalAmount += m.totalAmount
    }
    return Array.from(yearMap.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [stats.byMonth, period])

  const currentPeriodLabel = useMemo(() => {
    if (period === 'month') {
      return `${now.getFullYear()}年${now.getMonth() + 1}月`
    }
    if (period === 'quarter') {
      const q = Math.ceil((now.getMonth() + 1) / 3)
      return `${now.getFullYear()} Q${q}`
    }
    return `${now.getFullYear()}年`
  }, [period])

  const currentPeriodGroup = useMemo(() => {
    if (period === 'month') {
      const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const thisMonthStat = stats.byMonth.find((m) => m.month === thisMonthKey)
      return { count: thisMonthStat?.count ?? 0, totalAmount: thisMonthStat?.totalAmount ?? 0 }
    }
    if (period === 'quarter') {
      const q = Math.ceil((now.getMonth() + 1) / 3)
      const key = `${now.getFullYear()}-Q${q}`
      return periodGroups.find((g) => g.label === `${now.getFullYear()} Q${q}`) ?? { count: 0, totalAmount: 0 }
    }
    const yearStr = `${now.getFullYear()}`
    return periodGroups.find((g) => g.label === yearStr) ?? { count: 0, totalAmount: 0 }
  }, [period, stats.byMonth, periodGroups])

  const chartOption = useMemo(() => {
    if (period === 'month') {
      return {
        tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 4, borderColor: 'var(--bg-base)', borderWidth: 2 },
          label: { show: true, position: 'outside', formatter: '{b}\n{d}%', fontSize: 10, color: 'var(--fg-text)' },
          emphasis: { label: { fontSize: 14, fontWeight: 'bold' } },
          data: stats.byCategory.map((group) => ({
            name: group.category,
            value: Math.round(group.totalAmount * 100) / 100,
            itemStyle: { color: getCategoryColor(group.category) }
          }))
        }]
      }
    }

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: Array<{ name: string; value: number }>) => {
          const p = params[0]
          return `${p.name}<br/>¥${formatAmount(p.value)}`
        }
      },
      xAxis: {
        type: 'category',
        data: periodGroups.map((g) => g.label),
        axisLabel: { fontSize: 10, color: 'var(--fg-text)' },
        axisLine: { lineStyle: { color: 'var(--border-default)' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          fontSize: 10,
          color: 'var(--fg-text)',
          formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)
        },
        splitLine: { lineStyle: { color: 'var(--border-default)', type: 'dashed' } }
      },
      series: [{
        type: 'bar',
        data: periodGroups.map((g) => Math.round(g.totalAmount * 100) / 100),
        itemStyle: {
          color: 'var(--accent-primary)',
          borderRadius: [4, 4, 0, 0]
        },
        barMaxWidth: 40
      }],
      grid: { left: 50, right: 16, top: 16, bottom: 30 }
    }
  }, [period, stats.byCategory, periodGroups])

  return (
    <div className="statistics-view">
      <div className="stats-header">
        <span className="stats-title">金额统计</span>
      </div>

      <div className="stats-period-switch">
        <button
          className={`stats-period-btn ${period === 'month' ? 'active' : ''}`}
          onClick={() => setPeriod('month')}
        >
          按月
        </button>
        <button
          className={`stats-period-btn ${period === 'quarter' ? 'active' : ''}`}
          onClick={() => setPeriod('quarter')}
        >
          按季
        </button>
        <button
          className={`stats-period-btn ${period === 'year' ? 'active' : ''}`}
          onClick={() => setPeriod('year')}
        >
          按年
        </button>
      </div>

      <div className="stats-content">
        <div className="stats-summary">
          <div className="stat-card">
            <span className="stat-card-value">{stats.totalCount}</span>
            <span className="stat-card-label">发票总数</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-value large">¥{formatAmount(stats.totalAmount)}</span>
            <span className="stat-card-label">价税合计</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-value">{stats.byStatus.pending}</span>
            <span className="stat-card-label">待报销</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-value">{stats.byStatus.reimbursed}</span>
            <span className="stat-card-label">已报销</span>
          </div>
        </div>

        <div className="stats-total">
          <div className="stats-total-row">
            <span className="stats-total-label">{currentPeriodLabel}合计</span>
            <span className="stats-total-value">¥{formatAmount(currentPeriodGroup.totalAmount)}</span>
          </div>
          <div className="stats-total-row">
            <span className="stats-total-label">{currentPeriodLabel}发票</span>
            <span className="stats-total-value">{currentPeriodGroup.count} 张</span>
          </div>
          <div className="stats-total-row">
            <span className="stats-total-label">已报销</span>
            <span className="stats-total-value">{stats.byStatus.reimbursed} 张</span>
          </div>
          <div className="stats-total-row">
            <span className="stats-total-label">待报销</span>
            <span className="stats-total-value">{stats.byStatus.pending} 张</span>
          </div>
        </div>

        <div className="stats-section">
          <div className="stats-section-title">
            {period === 'month' ? '分类统计' : period === 'quarter' ? '季度趋势' : '年度趋势'}
          </div>
          {period === 'month' ? (
            stats.byCategory.length === 0 ? (
              <div style={{ color: 'var(--fg-overlay0)', fontSize: 13, padding: 12 }}>
                暂无数据
              </div>
            ) : (
              <>
                <div style={{ height: '260px', marginBottom: '8px' }}>
                  <ReactECharts
                    option={chartOption}
                    style={{ height: '100%', width: '100%' }}
                    opts={{ renderer: 'svg' }}
                  />
                </div>
                {stats.byCategory.map((group) => {
                  const icon = getCategoryIcon(group.category)
                  const color = getCategoryColor(group.category)
                  const percent = stats.totalAmount > 0
                    ? ((group.totalAmount / stats.totalAmount) * 100).toFixed(1)
                    : '0'
                  const handleCategoryClick = () => {
                    setFilterCategory(group.category)
                    if (!leftPanelVisible) toggleLeftPanel()
                    setLeftPanelTab('tree')
                  }
                  return (
                    <div key={group.category} className="stats-bar-item" onClick={handleCategoryClick} title="点击过滤此类发票">
                      <div className="stats-bar-label">
                        <span className="stats-bar-name">
                          {icon} {group.category}
                        </span>
                        <span className="stats-bar-count">
                          {percent}% {group.count}张
                        </span>
                      </div>
                      <div className="stats-bar-track">
                        <div
                          className="stats-bar-fill"
                          style={{
                            width: `${(group.totalAmount / (stats.totalAmount || 1)) * 100}%`,
                            backgroundColor: color
                          }}
                        />
                      </div>
                      <span className="stats-bar-amount">¥{formatAmount(group.totalAmount)}</span>
                    </div>
                  )
                })}
              </>
            )
          ) : periodGroups.length === 0 ? (
            <div style={{ color: 'var(--fg-overlay0)', fontSize: 13, padding: 12 }}>
              暂无数据
            </div>
          ) : (
            <>
              <div style={{ height: '260px', marginBottom: '8px' }}>
                <ReactECharts
                  option={chartOption}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'svg' }}
                />
              </div>
              {periodGroups.map((g) => (
                <div key={g.label} className="stats-bar-item">
                  <div className="stats-bar-label">
                    <span className="stats-bar-name">{g.label}</span>
                    <span className="stats-bar-count">{g.count}张</span>
                  </div>
                  <div className="stats-bar-track">
                    <div
                      className="stats-bar-fill"
                      style={{
                        width: `${(g.totalAmount / (stats.totalAmount || 1)) * 100}%`,
                        backgroundColor: 'var(--accent-primary)'
                      }}
                    />
                  </div>
                  <span className="stats-bar-amount">¥{formatAmount(g.totalAmount)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
