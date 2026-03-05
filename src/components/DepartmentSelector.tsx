import { View, Text, Checkbox, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import './DepartmentSelector.css'

// 科室列表
const DEPARTMENTS = [
  '1诊室', '2诊室', '4诊室', '5诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿4', '妇儿前', 'VIP/男2', '男3', '女2'
]

const DEFAULT_DEPARTMENTS = [
  '1诊室', '2诊室', '4诊室', '5诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿4', '妇儿前', 'VIP/男2', '男3', '女2'
]

const DEFAULT_WEEKEND_DEPARTMENTS = ['1诊室', '2诊室', '4诊室', '5诊室']

interface DepartmentSelectorProps {
  selectedDepartments: {
    Monday: string[]
    Tuesday: string[]
    Wednesday: string[]
    Thursday: string[]
    Friday: string[]
    Saturday: string[]
    Sunday: string[]
  }
  onChange: (selectedDepartments: DepartmentSelectorProps['selectedDepartments']) => void
}

const DepartmentSelector = ({ selectedDepartments, onChange }: DepartmentSelectorProps) => {
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

    onChange(newSelected)
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
          onChange(defaultSelected)
          Taro.showToast({
            title: '已重置',
            icon: 'success'
          })
        }
      }
    })
  }

  return (
    <View className="department-selector">
      <View className="department-selector-header">
        <Text className="department-selector-title">科室选择</Text>
        <View className="department-selector-actions">
          <Button
            className="department-selector-reset-btn"
            size="mini"
            onClick={resetToDefault}
          >
            重置
          </Button>
        </View>
      </View>

      <ScrollView className="department-selector-content" scrollY>
        {days.map((day) => (
          <View key={day.key} className="department-selector-day">
            <View className="department-selector-day-header">
              <Text className="department-selector-day-title">{day.label}</Text>
              <Text className="department-selector-day-count">
                已选择：{selectedDepartments[day.key as keyof typeof selectedDepartments].length}个
              </Text>
            </View>
            <View className="department-selector-departments">
              {DEPARTMENTS.map((dept) => (
                <View
                  key={dept}
                  className="department-checkbox-wrapper"
                  onClick={() => handleToggleDepartment(day.key, dept)}
                >
                  <Checkbox
                    checked={selectedDepartments[day.key as keyof typeof selectedDepartments].includes(dept)}
                    color="#1890ff"
                  />
                  <Text className="department-checkbox-label">{dept}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="department-selector-footer">
        <Text className="department-selector-tip">说明：每天至少选择4个科室，每次重置为默认值</Text>
      </View>
    </View>
  )
}

export default DepartmentSelector
