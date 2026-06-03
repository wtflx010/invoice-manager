import type { InvoiceCategory } from '../types/invoice'

export const allCategories: InvoiceCategory[] = [
  '餐饮', '住宿', '机票', '车票', '打车', '办公用品',
  '通讯费', '会议费', '培训费', '加油费', '过路费', '停车费', '其他'
]

const classificationRules: Record<InvoiceCategory, string[]> = {
  餐饮: [
    '餐饮', '火锅', '餐厅', '饭店', '食堂', '外卖', '食品',
    '海底捞', '麦当劳', '肯德基', '星巴克', '美团', '饿了么',
    '大众点评', '西贝', '大董', '喜茶', '奈雪', '必胜客', '汉堡王',
    '茶馆', '茶楼', '茶餐厅', '奶茶', '咖啡', '烘焙', '面包',
    '烧烤', '串串', '小吃', '快餐', '面馆', '粥', '粉店',
    '猪肚鸡', '潮汕', '湘菜', '川菜', '粤菜', '鲁菜', '苏菜'
  ],
  住宿: [
    '酒店', '宾馆', '民宿', '旅社', '住宿', '旅馆', '客栈',
    '如家', '汉庭', '万豪', '希尔顿', '洲际', '锦江',
    '华住', '亚朵', '全季', '七天', '旅行社', '商旅',
    '公寓', '度假', '山庄'
  ],
  机票: [
    '航空', '机票', '航班', '国航', '东航', '南航', '海航',
    '春秋', '携程商旅', 'travelsky', '行程单', '航空运输',
    '机场', '登机', '客票'
  ],
  车票: [
    '铁路', '火车', '高铁', '12306', '中铁', '客运', '动车',
    '列车', '火车票', '站票'
  ],
  打车: [
    '滴滴', '曹操', 'T3', '首汽', '出租', '网约车', '高德打车',
    '花小猪', '嘀嗒', '优行', '畅行', '出行科技', '出行服务',
    '吉利优行', '打车'
  ],
  办公用品: [
    '办公', '文具', '打印', '耗材', '京东', '齐心',
    '晨光', '得力', '惠普', '佳能', '商贸', '商贸有限',
    '优衣库', '迅销'
  ],
  通讯费: [
    '通讯', '话费', '电信', '移动', '联通', '网络', '宽带',
    '通信', '手机', '信息科技'
  ],
  会议费: [
    '会议', '会展', '论坛', '峰会', '研讨'
  ],
  培训费: [
    '培训', '课程', '教育', '讲座', '学习', '咨询'
  ],
  加油费: [
    '加油站', '石化', '石油', '壳牌', '中石化', '中石油', 'BP',
    '加油加气', '加气站', '能源', '燃油', '汽柴油'
  ],
  过路费: [
    '高速', '通行', 'ETC', '路桥', '高速公路', '交通控股',
    '公路', '大桥', '绕城', '营运'
  ],
  停车费: [
    '停车', '泊车', '车位', '停车场'
  ],
  其他: []
}

const invoiceTypeCategoryMap: Record<string, InvoiceCategory> = {
  '航空运输电子客票行程单': '机票',
  '铁路客票': '车票',
  '铁路电子客票': '车票',
  '增值税专用发票': '办公用品',
  '增值税普通发票': '其他',
  '全电增值税专用发票': '办公用品',
  '全电增值税普通发票': '其他',
  '机动车销售统一发票': '其他',
  '二手车销售统一发票': '其他',
  '货物运输业增值税专用发票': '过路费',
  '出租车发票': '打车',
  '定额发票': '其他',
  '过路费发票': '过路费',
  '通行费发票': '过路费',
  '加油发票': '加油费',
  '火车票': '车票',
  '机票行程单': '机票',
  '客运发票': '车票',
  '酒店发票': '住宿',
  '餐饮发票': '餐饮',
  '通讯费发票': '通讯费',
  '会议费发票': '会议费',
  '培训费发票': '培训费'
}

export function classifyInvoice(text: string, invoiceType?: string, sellerName?: string): InvoiceCategory {
  // 先用关键词匹配（更精确）
  const combinedText = [text, sellerName || ''].join(' ').toLowerCase()

  let bestCategory: InvoiceCategory = '其他'
  let bestScore = 0

  for (const [category, keywords] of Object.entries(classificationRules)) {
    let score = 0
    for (const keyword of keywords) {
      if (combinedText.includes(keyword.toLowerCase())) {
        score++
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestCategory = category as InvoiceCategory
    }
  }

  // 如果关键词匹配到了非"其他"的分类，优先使用
  if (bestScore > 0 && bestCategory !== '其他') {
    return bestCategory
  }

  // 关键词没匹配到，再用 invoiceType 映射
  if (invoiceType && invoiceTypeCategoryMap[invoiceType]) {
    return invoiceTypeCategoryMap[invoiceType]
  }

  return bestCategory
}

const categoryIcons: Record<InvoiceCategory, string> = {
  餐饮: '🍽️',
  住宿: '🏨',
  机票: '✈️',
  车票: '🚄',
  打车: '🚗',
  办公用品: '🖨️',
  通讯费: '📱',
  会议费: '🎤',
  培训费: '📚',
  加油费: '⛽',
  过路费: '🛣️',
  停车费: '🅿️',
  其他: '📦'
}

export function getCategoryIcon(category: InvoiceCategory): string {
  return categoryIcons[category] || '📄'
}

const categoryColors: Record<InvoiceCategory, string> = {
  餐饮: '#f38ba8',
  住宿: '#cba6f7',
  机票: '#89b4fa',
  车票: '#94e2d5',
  打车: '#f9e2af',
  办公用品: '#a6e3a1',
  通讯费: '#fab387',
  会议费: '#eba0ac',
  培训费: '#b4befe',
  加油费: '#f5c2e7',
  过路费: '#89dceb',
  停车费: '#74c7ec',
  其他: '#6c7086'
}

export function getCategoryColor(category: InvoiceCategory): string {
  return categoryColors[category] || '#6c7086'
}

export { classificationRules }