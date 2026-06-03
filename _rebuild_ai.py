"""Rebuild AI assistant: text-based tool calls + rich context injection"""
import sys

with open('src/renderer/src/components/ChatPanel/ChatPanel.tsx', 'r', encoding='utf-8') as f:
    cc = f.read()

changes = []

# === Fix 1: Add back agentTools import ===
old_import = """import { executeTool } from '../../tools/toolExecutor'"""
new_import = """import { agentTools } from '../../tools/agentTools'
import { executeTool } from '../../tools/toolExecutor'"""

if old_import in cc and 'agentTools' not in cc[:old_import.find(old_import) + 200]:
    cc = cc.replace(old_import, new_import)
    changes.append('Added agentTools import')
else:
    changes.append('agentTools import already there or not found')

# === Fix 2: Enhanced stats summary ===
old_stats = """      const totalAmount = invoices.reduce((s, i) => s + i.totalAmount, 0)
      const byCat = new Map<string, { count: number; total: number }>()
      for (const inv of invoices) {
        if (!byCat.has(inv.category)) byCat.set(inv.category, { count: 0, total: 0 })
        byCat.get(inv.category)!.count++
        byCat.get(inv.category)!.total += inv.totalAmount
      }
      const topCats = Array.from(byCat.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .map(([cat, d]) => `${cat}(${d.count}张, \\u00a5${d.total.toFixed(0)})`)
        .join(' / ')
      const statsSummary = invoices.length > 0
        ? `\\n\\n当前系统共有 ${invoices.length} 张发票，总额 \\u00a5${totalAmount.toFixed(2)}。`
          + `待报销 ${invoices.filter((i) => i.status === 'pending').length} 张，已报销 ${invoices.filter((i) => i.status === 'reimbursed').length} 张。`
          + `\\n主要类别: ${topCats}`
        : '\\n\\n当前系统中暂无发票数据。'"""

new_stats = """      const totalAmount = invoices.reduce((s, i) => s + i.totalAmount, 0)
      const pending = invoices.filter((i) => i.status === 'pending').length
      const reimbursed = invoices.filter((i) => i.status === 'reimbursed').length

      const byCat = new Map<string, { count: number; total: number }>()
      for (const inv of invoices) {
        if (!byCat.has(inv.category)) byCat.set(inv.category, { count: 0, total: 0 })
        byCat.get(inv.category)!.count++
        byCat.get(inv.category)!.total += inv.totalAmount
      }
      const topCats = Array.from(byCat.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .map(([cat, d]) => `${cat}(${d.count}\u5f20, \u00a5${d.total.toFixed(0)})`)
        .join('\u3001')

      const allTags = new Set<string>()
      invoices.forEach(i => (i.tags || []).forEach(t => allTags.add(t)))
      const tagList = Array.from(allTags).sort().slice(0, 20).join('\u3001')

      const recentInvoices = [...invoices]
        .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
        .slice(0, 5)

      let recentSummary = ''
      if (recentInvoices.length > 0) {
        recentSummary = recentInvoices.map(i =>
          `${i.issueDate} | ${i.sellerName || '\u672a\u77e5'} | \u00a5${i.totalAmount.toFixed(2)} | ${i.category} | ${i.status === 'pending' ? '\u5f85\u62a5\u9500' : '\u5df2\u62a5\u9500'}`
        ).join('\\n  ')
      }

      const toolDescriptions = agentTools.map(t => {
        const params = Object.entries(t.parameters).map(([k, v]) => `${k}:${v.type}`).join(', ')
        return `  - **${t.name}**: ${t.description} (参数: ${params})`
      }).join('\\n')

      const statsSummary = invoices.length > 0
        ? `\\n## \u5f53\u524d\u7cfb\u7edf\u6570\u636e\\n- \u5171 ${invoices.length} \u5f20\u53d1\u7968\uff0c\u603b\u989d \u00a5${totalAmount.toFixed(2)}\\n- \u5f85\u62a5\u9500 ${pending} \u5f20\uff0c\u5df2\u62a5\u9500 ${reimbursed} \u5f20\\n- \u4e3b\u8981\u7c7b\u522b: ${topCats}${tagList ? '\\n- \u5df2\u7528\u6807\u7b7e: ' + tagList : ''}${recentSummary ? '\\n- \u6700\u8fd1\u53d1\u7968:\\n  ' + recentSummary : ''}\\n\\n## \u53ef\u7528\u5de5\u5177\\n${toolDescriptions}\\n\\n## \u5de5\u5177\u8c03\u7528\u65b9\u5f0f\\n\u4f60\u53ef\u4ee5\u901a\u8fc7\u4ee5\u4e0b\u683c\u5f0f\u8c03\u7528\u5de5\u5177\uff1a\\n\\n\`\`\`tool\\n{\\"tool\\": \\"\u5de5\u5177\u540d\u79f0\\", \\"params\\": {\\"\u53c2\u6570\u540d\\": \\"\u53c2\u6570\u503c\\"}}\\n\`\`\`\\n\\n\u4f60\u53ef\u4ee5\u5728\u4e00\u6761\u6d88\u606f\u4e2d\u5305\u542b\u591a\u4e2a\u5de5\u5177\u8c03\u7528\u3002\u5de5\u5177\u6267\u884c\u7ed3\u679c\u4f1a\u81ea\u52a8\u56de\u4f20\u7ed9\u4f60\u3002\u4e0d\u8981\u5728\u6ca1\u6709\u67e5\u8be2\u7684\u60c5\u51b5\u4e0b\u731c\u6d4b\u6570\u636e\u3002'`
        : '\\n\\n\u5f53\u524d\u7cfb\u7edf\u4e2d\u6682\u65e0\u53d1\u7968\u6570\u636e\u3002\\n\\n\u4f60\u662f\u4e00\u4e2a\u4e13\u4e1a\u7684\u53d1\u7968\u7ba1\u7406\u52a9\u624b\uff0c\u53ef\u4ee5\u5e2e\u7528\u6237\u5206\u6790\u53d1\u7968\u3001\u89e3\u7b54\u95ee\u9898\u3002\u5f53\u7528\u6237\u5bfc\u5165\u53d1\u7968\u540e\uff0c\u4f60\u5c31\u53ef\u4ee5\u4f7f\u7528\u5de5\u5177\u6765\u641c\u7d22\u548c\u7ba1\u7406\u53d1\u7968\u3002'"""

if old_stats in cc:
    cc = cc.replace(old_stats, new_stats)
    changes.append('Enhanced statsSummary with tool descriptions + recent data')
else:
    changes.append('ERROR: statsSummary not found')

# === Fix 3: System prompt → just inject stats ===
old_sys = """{ role: 'system', content: `你是一个专业的中国企业发票管理智能助手。

## 核心能力
你能通过调用工具来管理发票，包括：搜索发票、查看详情、统计数据、修改类别/状态/备注、标签管理、查重去重、金额筛选、批量操作、月度汇总。

## 行为准则
1. **先思考再行动**：收到用户问题后，先分析意图，确定需要哪个工具，然后调用。
2. **一次一个工具**：每次只调用一个工具，等待结果返回后再决定下一步。不要一次调用多个无关工具。
3. **用数据说话**：回复中必须包含工具返回的具体数据（数量、金额、名称等），不要泛泛而谈。
4. **主动引导**：如果工具返回空结果，建议用户换关键词或调整查询条件。
5. **格式规范**：金额始终带「¥」符号，日期保持 YYYY-MM-DD 格式。
6. **不确定时确认**：如果用户意图模糊，先询问确认再操作。

## 可用发票类别
餐饮、住宿、机票、车票、打车、办公用品、通讯费、会议费、培训费、加油费、过路费、停车费、其他

## 示例
用户："这个月花了多少钱"
→ 调用 get_monthly_summary(year=2025, month=当前月) 获取数据后回复

用户："把海底捞的发票找出来"
→ 调用 search_invoices(query="海底捞") 搜索后列出

用户："给差旅相关的发票加个标签"
→ 调用 search_invoices(query="差旅") 找到相关发票，再调用 add_tags 逐张添加

${statsSummary}${fileContext ? '\\n正在处理的文件：' + fileContext : ''}${webContext ? '\\n' + webContext : ''}` }"""

new_sys = """{ role: 'system', content: `你是中国企业发票管理助手。你拥有查询和操作发票数据库的能力。

## 身份与语气
用中文回复，简洁专业。用「你」称呼用户。金额标注 ¥。日期格式 YYYY-MM-DD。

## 发票类别
餐饮、住宿、机票、车票、打车、办公用品、通讯费、会议费、培训费、加油费、过路费、停车费、其他

## 工作方式
你通过工具获取数据。当需要查询或操作发票时，用以下格式请求工具：

\\`\\`\\`tool
{"tool": "工具名", "params": {"参数": "值"}}
\\`\\`\\`

你可以在一句话中包含多个 tool 代码块，每个都会被执行。执行结果会自动回传给你。如果不需要工具，直接回复。

## 重要规则
1. 不要编造数据，所有数据必须来自工具查询
2. 给出具体名称和数字，不要泛泛而谈
3. 不确定时主动询问
4. 如果用户问的是系统当前数据，优先用已注入的统计信息回答

${statsSummary}${fileContext ? '\\n正在处理文件: ' + fileContext : ''}${webContext ? '\\n' + webContext : ''}` }"""

if old_sys in cc:
    cc = cc.replace(old_sys, new_sys)
    changes.append('Rewritten system prompt with tool call format')
else:
    changes.append('ERROR: old system prompt not found')

# === Fix 4: Replace empty response + add text tool parsing ===
# After the streaming/JSON response parsing block (around line 354), 
# replace the toolCalls block and empty check with text-tool parsing

old_tool_block = """      if (!assistantContent && !toolCalls) {
        console.log('[CHAT] FINAL: EMPTY! isStream:', ipcResult.isStream, 'bodyType:', typeof ipcResult.body, 'bodySnippet:', String(ipcResult.body).slice(0, 200))
        setMessages((prev) =>"""

new_tool_block = """      const parseToolCalls = (text: string): Array<{ tool: string; params: Record<string, unknown> }> => {
        const results: Array<{ tool: string; params: Record<string, unknown> }> = []
        const regex = /```tool\s*\n([\s\S]*?)```/g
        let match
        while ((match = regex.exec(text)) !== null) {
          try {
            const parsed = JSON.parse(match[1].trim())
            if (parsed.tool && parsed.params) {
              results.push({ tool: String(parsed.tool), params: parsed.params as Record<string, unknown> })
            }
          } catch { /* skip */ }
        }
        return results
      }

      const textToolCalls = parseToolCalls(assistantContent)

      if (textToolCalls.length > 0) {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantMsgId ? {
            ...m, content: assistantContent + '\\n\\n\u23f3 \u6267\u884c\u5de5\u5177\u4e2d...'
          } : m)
        )

        const toolResults: Array<{ tool: string; result: unknown }> = []
        for (const tc of textToolCalls) {
          const toolResult = await executeTool(tc.tool, tc.params)
          toolResults.push({ tool: tc.tool, result: toolResult })
        }

        const toolResultsText = toolResults.map(tr =>
          `${tr.tool}: ${JSON.stringify(tr.result)}`
        ).join('\\n')

        setMessages((prev) =>
          prev.map((m) => m.id === assistantMsgId ? {
            ...m, content: assistantContent + '\\n\\n\u2705 \u5df2\u6267\u884c ' + textToolCalls.length + ' \u4e2a\u5de5\u5177'
          } : m)
        )

        const followUpBody: Record<string, unknown> = {
          model: settings.aiModel || 'gpt-4',
          stream: true,
          messages: [
            { role: 'system', content: '\u4f60\u662f\u53d1\u7968\u7ba1\u7406\u52a9\u624b\u3002\u7528\u6237\u8bf7\u6c42\u4f60\u6267\u884c\u4e86\u5de5\u5177\uff0c\u4e0b\u9762\u662f\u7ed3\u679c\u3002\u8bf7\u7528\u7b80\u6d01\u4e2d\u6587\u603b\u7ed3\u5173\u952e\u4fe1\u606f\u3002\u4e0d\u8981\u518d\u8c03\u7528\u5de5\u5177\u3002' },
            { role: 'user', content: '\u5de5\u5177\u6267\u884c\u7ed3\u679c\uff1a\\n' + toolResultsText }
          ],
          temperature: settings.aiTemperature ?? 0.3,
          max_tokens: settings.aiMaxTokens ?? 4096
        }

        try {
          const fuRes = await chatViaIPC(followUpBody)
          let summary = ''
          if (fuRes.isStream && typeof fuRes.body === 'string') {
            for (const line of fuRes.body.split('\\n')) {
              const t = line.trim()
              if (!t.startsWith('data: ')) continue
              const d = t.slice(6)
              if (d === '[DONE]') continue
              try {
                const c = JSON.parse(d)
                const txt = c.choices?.[0]?.delta?.content
                if (txt != null && txt !== '') {
                  summary += String(txt)
                  setMessages((prev) =>
                    prev.map((m) => m.id === assistantMsgId ? { ...m, content: assistantContent + '\\n\\n---\\n' + summary } : m)
                  )
                }
              } catch { /* skip */ }
            }
          } else if (fuRes.body) {
            const fr = fuRes.body as Record<string, unknown>
            const fc = fr.choices as Array<Record<string, unknown>> | undefined
            const fm = fc?.[0]?.message as Record<string, unknown> | undefined
            if (fm?.content != null && String(fm.content) !== '') {
              summary = String(fm.content)
              setMessages((prev) =>
                prev.map((m) => m.id === assistantMsgId ? { ...m, content: assistantContent + '\\n\\n---\\n' + summary } : m)
              )
            }
          }
        } catch { /* follow-up failed, leave tool results visible */ }
      } else if (!assistantContent) {
        setMessages((prev) =>"""

if old_tool_block in cc:
    cc = cc.replace(old_tool_block, new_tool_block)
    changes.append('Added text-based tool call parsing + execution loop')
else:
    changes.append('ERROR: old_tool_block not found')

# === Fix 5: Update empty response text ===
old_empty_text = """（AI 返回了空回复）"""
new_empty_text = """（AI 返回了空回复，请检查模型配置或尝试重新提问）"""

if old_empty_text in cc:
    cc = cc.replace(old_empty_text, new_empty_text)
    changes.append('Updated empty response message')

with open('src/renderer/src/components/ChatPanel/ChatPanel.tsx', 'w', encoding='utf-8') as f:
    f.write(cc)

for c in changes:
    print(f'  {c}')
print('AI assistant rebuilt!')