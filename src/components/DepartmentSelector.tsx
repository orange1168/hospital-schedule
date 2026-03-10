import { View, Text, ScrollView, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './DepartmentSelector.css'

// 完整的科室列表（包括1诊室，用于科室设置弹窗）
const DEPARTMENTS = [
  '1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿3', '妇儿4', 'VIP1', 'VIP2', '男1', '男2', '男3', '女1', '女2', '女3'
]

// 工作日默认科室（不包括9诊室，男1，男3，女1，VIP1）
const DEFAULT_DEPARTMENTS = [
  '1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '10诊室',
  '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男2', '女2', '女3'
]

// 周末默认科室（前四个加上妇儿4）
const DEFAULT_WEEKEND_DEPARTMENTS = ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '妇儿4']

interface DepartmentSelectorProps {
  visible: boolean
  onClose: () => void
  selectedDepartments: {
    Monday: string[]
    Tuesday: string[]
    Wednesday: string[]
    Thursday: string[]
    Friday: string[]
    Saturday: string[]
    Sunday: string[]
  }
  onDepartmentsChange: (selectedDepartments: DepartmentSelectorProps['selectedDepartments']) => void
}

const DepartmentSelector = ({ visible, onClose, selectedDepartments, onDepartmentsChange }: DepartmentSelectorProps) => {
  const days = [
    { key: 'Monday', label: '周一' },
    { key: 'Tuesday', label: '周二' },
    { key: 'Wednesday', label: '周三' },
    { key: 'Thursday', label: '周四' },
    { key: 'Friday', label: '周五' },
    { key: 'Saturday', label: '周六' },
    { key: 'Sunday', label: '周日' }
  ]

  const handleToggleDepartment = (day: string, dept: string) => {
    const newSelected = { ...selectedDepartments }
    const dayDepartments = newSelected[day as keyof typeof selectedDepartments]

    if (dayDepartments.includes(dept)) {
      // 取消选择
      if (dayDepartments.length > 4) {
        // 只有超过4个才能取消
        newSelected[day as keyof typeof selectedDepartments] = dayDepartments.filter(d => d !== dept)
      } else {
        // 至少保留4个
        Taro.showToast({
          title: `${day}至少需要选择4个科室`,
          icon: 'none'
        })
        return
      }
    } else {
      // 添加选择
      newSelected[day as keyof typeof selectedDepartments] = [...dayDepartments, dept]
    }

    onDepartmentsChange(newSelected)
  }

  const resetToDefault = () => {
    Taro.showModal({
      title: '重置科室',
      content: '确定要重置为默认值吗？',
      success: (res) => {
        if (res.confirm) {
          const defaultSelected = {
            Monday: [...DEFAULT_DEPARTMENTS],
            Tuesday: [...DEFAULT_DEPARTMENTS],
            Wednesday: [...DEFAULT_DEPARTMENTS],
            Thursday: [...DEFAULT_DEPARTMENTS],
            Friday: [...DEFAULT_DEPARTMENTS],
            Saturday: [...DEFAULT_WEEKEND_DEPARTMENTS],
            Sunday: [...DEFAULT_WEEKEND_DEPARTMENTS]
          }
          onDepartmentsChange(defaultSelected)
          Taro.showToast({
            title: '已重置',
            icon: 'success'
          })
        }
      }
    })
  }

  if (!visible) {
    return null
  }

  return (
    <View className="department-selector-overlay">
      <View className="department-selector-modal">
        <View className="department-selector-header">
          <Text className="department-selector-title">科室选择</Text>
          <View
            className="department-selector-close"
            // 🔴 H5 端兼容：使用 onClick 和 onTap
            onClick={onClose}
            onTap={onClose}
          >
            <Text className="department-selector-close-icon">×</Text>
          </View>
        </View>

        <View className="department-selector-toolbar">
          <Button
            className="department-selector-reset-btn"
            size="mini"
            // 🔴 H5 端兼容：使用 onClick 和 onTap
            onClick={resetToDefault}
            onTap={resetToDefault}
          >
            重置为默认
          </Button>
          <Text className="department-selector-tip">每天至少选择4个科室</Text>
        </View>

        <ScrollView className="department-selector-content" scrollY>
          {days.map((day) => (
            <View key={day.key} className="department-selector-day">
              <View className="department-selector-day-header">
                <Text className="department-selector-day-title">{day.label}</Text>
                <View className="department-selector-day-count">
                  <Text className="count-label">已选</Text>
                  <Text className="count-number">{selectedDepartments[day.key as keyof typeof selectedDepartments].length}</Text>
                </View>
              </View>
              <View className="department-selector-departments">
                {DEPARTMENTS.map((dept) => (
                  <View
                    key={dept}
                    className={`department-checkbox-wrapper ${selectedDepartments[day.key as keyof typeof selectedDepartments].includes(dept) ? 'checked' : ''}`}
                    style={{ cursor: 'pointer' }}
                    // 🔴 H5 端兼容：使用 onClick 和 onTap
                    onClick={() => handleToggleDepartment(day.key, dept)}
                    onTap={() => handleToggleDepartment(day.key, dept)}
                  >
                    <Text className="department-checkbox-text">{dept}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

export default DepartmentSelector
