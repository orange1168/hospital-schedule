import { View, Text, Button, ScrollView, Picker } from '@tarojs/components'
import { useState } from 'react'
import { Network } from '@/network'
import Taro from '@tarojs/taro'
import './index.css'

interface ScheduleData {
  dates: string[]
  datesWithWeek: string[]
  departments: string[]
  schedule: Record<string, Record<string, Array<{ doctor: string; shift: 'morning' | 'afternoon' | 'night' | 'off'; department?: string }>>>
  dutySchedule: Record<string, string>
  doctorSchedule: Record<string, {
    name: string
    shifts: Record<string, 'morning' | 'afternoon' | 'night' | 'off'>
    morningShifts: string[]
    afternoonShifts: string[]
    nightShifts: number
    restDays: number
  }>
  useHalfDay: boolean
}

// 固定的医生列表
const FIXED_DOCTORS = [
  '李茜', '姜维', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎', '杨波',
  '李丹', '黄丹', '邬海燕', '罗丹', '彭粤如', '周晓宇'
]

const IndexPage = () => {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)
  
  const [startDate, setStartDate] = useState('')
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([])
  const [customDoctors, setCustomDoctors] = useState<string[]>([])
  const [dutyStartDoctor, setDutyStartDoctor] = useState<string>('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customDoctorName, setCustomDoctorName] = useState('')
  const [loading, setLoading] = useState(false)

  // 生成排班
  const handleGenerateSchedule = async () => {
    if (!startDate) {
      Taro.showToast({
        title: '请选择开始日期',
        icon: 'none'
      })
      return
    }

    if (selectedDoctors.length === 0) {
      Taro.showToast({
        title: '请至少选择一名医生',
        icon: 'none'
      })
      return
    }

    if (!dutyStartDoctor) {
      Taro.showToast({
        title: '请选择值班起始医生',
        icon: 'none'
      })
      return
    }

    setLoading(true)

    try {
      console.log('开始生成排班，参数:', { startDate, doctors: selectedDoctors, dutyStartDoctor })
      const res = await Network.request({
        url: '/api/schedule/generate',
        method: 'POST',
        data: {
          startDate,
          doctors: selectedDoctors,
          dutyStartDoctor,
          leaveDoctors: []
        }
      })
      console.log('排班生成响应:', res.data)

      if (res.data.code === 200) {
        setScheduleData(res.data.data)
        Taro.showToast({
          title: '排班生成成功',
          icon: 'success'
        })
      } else {
        Taro.showToast({
          title: res.data.msg || '排班生成失败',
          icon: 'none'
        })
      }
    } catch (error) {
      console.error('排班生成失败:', error)
      Taro.showToast({
        title: error?.message || '排班生成失败',
        icon: 'none'
      })
    } finally {
      setLoading(false)
    }
  }

  // 下载doc文档
  const handleDownloadDoc = async () => {
    if (!scheduleData) {
      Taro.showToast({
        title: '请先生成排班',
        icon: 'none'
      })
      return
    }

    try {
      console.log('开始下载文档')
      const res = await Network.request({
        url: '/api/schedule/download',
        method: 'POST',
        data: {
          scheduleData,
          startDate
        }
      })
      console.log('文档下载响应:', res.data)

      if (res.data.code === 200) {
        const isH5 = Taro.getEnv() === 'WEB'
        if (isH5) {
          const base64Data = res.data.data.fileData
          const link = document.createElement('a')
          link.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Data}`
          link.download = `排班表_${startDate}.docx`
          link.click()
          Taro.showToast({
            title: '文档下载成功',
            icon: 'success'
          })
        } else {
          Taro.showToast({
            title: '请在H5端下载文档',
            icon: 'none'
          })
        }
      } else {
        Taro.showToast({
          title: res.data.msg || '文档下载失败',
          icon: 'none'
        })
      }
    } catch (error) {
      console.error('文档下载失败:', error)
      Taro.showToast({
        title: '文档下载失败',
        icon: 'none'
      })
    }
  }

  // 切换医生选择状态
  const handleToggleDoctor = (doctor: string) => {
    if (selectedDoctors.includes(doctor)) {
      // 如果是值班起始医生，清空
      if (dutyStartDoctor === doctor) {
        setDutyStartDoctor('')
      }
      setSelectedDoctors(selectedDoctors.filter(d => d !== doctor))
    } else {
      setSelectedDoctors([...selectedDoctors, doctor])
    }
  }

  // 移除医生
  const handleRemoveDoctor = (doctor: string) => {
    if (dutyStartDoctor === doctor) {
      setDutyStartDoctor('')
    }
    setSelectedDoctors(selectedDoctors.filter(d => d !== doctor))
    // 如果是自定义医生，也从自定义列表中移除
    if (customDoctors.includes(doctor)) {
      setCustomDoctors(customDoctors.filter(d => d !== doctor))
    }
  }

  // 添加自定义医生
  const handleAddCustomDoctor = () => {
    if (!customDoctorName.trim()) {
      Taro.showToast({
        title: '请输入医生姓名',
        icon: 'none'
      })
      return
    }

    if (customDoctors.includes(customDoctorName.trim()) || FIXED_DOCTORS.includes(customDoctorName.trim())) {
      Taro.showToast({
        title: '该医生已存在',
        icon: 'none'
      })
      return
    }

    const newDoctor = customDoctorName.trim()
    setCustomDoctors([...customDoctors, newDoctor])
    setCustomDoctorName('')
    setShowCustomInput(false)
    
    // 自动选择新添加的医生
    setSelectedDoctors([...selectedDoctors, newDoctor])
    
    Taro.showToast({
      title: '添加成功',
      icon: 'success'
    })
  }

  // 选择值班起始医生
  const handleSelectDutyStartDoctor = () => {
    if (selectedDoctors.length === 0) {
      Taro.showToast({
        title: '请先选择排班医生',
        icon: 'none'
      })
      return
    }

    Taro.showActionSheet({
      itemList: selectedDoctors,
      success: (res) => {
        if (res.tapIndex !== undefined) {
          setDutyStartDoctor(selectedDoctors[res.tapIndex])
        }
      }
    })
  }

  return (
    <View className="min-h-screen bg-gray-50">
      <View className="bg-white p-4 sticky top-0 z-10 shadow-sm">
        <Text className="block text-xl font-bold text-center mb-4">医院排班系统</Text>

        <View className="flex flex-col gap-3">
          {/* 开始日期选择 */}
          <View className="flex flex-row items-center gap-2">
            <Text className="block text-sm font-medium w-24">开始日期：</Text>
            <View className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
              <Picker
                mode="date"
                value={startDate}
                onChange={(e) => setStartDate(e.detail.value)}
              >
                <Text className="block text-sm">{startDate || '请选择日期'}</Text>
              </Picker>
            </View>
          </View>

          {/* 值班起始医生 */}
          <View className="flex flex-row items-center gap-2">
            <Text className="block text-sm font-medium w-24">值班起始：</Text>
            <View 
              className="flex-1 bg-blue-50 rounded-lg px-3 py-2 border border-blue-200" 
              onClick={handleSelectDutyStartDoctor}
            >
              <Text className="block text-sm text-blue-600">{dutyStartDoctor || '点击选择'}</Text>
            </View>
          </View>

          {/* 可选医生区域 */}
          <View className="flex flex-col gap-2">
            <View className="flex flex-row items-center justify-between">
              <Text className="block text-sm font-medium">选择排班医生：</Text>
              <Button
                className="px-4 py-2 bg-green-500 text-white rounded-lg text-xs"
                onClick={() => setShowCustomInput(!showCustomInput)}
              >
                + 自定义医生
              </Button>
            </View>

            {/* 自定义医生输入框 */}
            {showCustomInput && (
              <View className="flex flex-row gap-2 items-center bg-green-50 p-2 rounded-lg">
                <View className="flex-1 bg-white rounded px-3 py-2">
                  <input
                    className="w-full text-sm bg-transparent outline-none"
                    placeholder="输入医生姓名"
                    value={customDoctorName}
                    onChange={(e) => setCustomDoctorName(e.target.value)}
                  />
                </View>
                <Button
                  className="px-4 py-2 bg-green-500 text-white rounded-lg text-xs"
                  onClick={handleAddCustomDoctor}
                >
                  添加
                </Button>
                <Button
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg text-xs"
                  onClick={() => {
                    setShowCustomInput(false)
                    setCustomDoctorName('')
                  }}
                >
                  取消
                </Button>
              </View>
            )}

            {/* 固定医生列表 */}
            <View className="bg-gray-50 rounded-lg p-3">
              <Text className="block text-xs text-gray-500 mb-2">固定医生（14人）：</Text>
              <View className="flex flex-row flex-wrap gap-2">
                {FIXED_DOCTORS.map((doctor) => {
                  const isSelected = selectedDoctors.includes(doctor)
                  return (
                    <View
                      key={doctor}
                      className={`flex flex-row items-center gap-1 px-3 py-1.5 rounded-full text-xs ${
                        isSelected
                          ? 'bg-blue-100 text-blue-700 border border-blue-300'
                          : 'bg-white text-gray-600 border border-gray-300'
                      }`}
                      onClick={() => handleToggleDoctor(doctor)}
                    >
                      <Text className="block text-xs">{doctor}</Text>
                    </View>
                  )
                })}
              </View>
            </View>

            {/* 自定义医生列表 */}
            {customDoctors.length > 0 && (
              <View className="bg-green-50 rounded-lg p-3">
                <Text className="block text-xs text-gray-500 mb-2">自定义医生（{customDoctors.length}人）：</Text>
                <View className="flex flex-row flex-wrap gap-2">
                  {customDoctors.map((doctor) => {
                    const isSelected = selectedDoctors.includes(doctor)
                    return (
                      <View
                        key={doctor}
                        className={`flex flex-row items-center gap-1 px-3 py-1.5 rounded-full text-xs ${
                          isSelected
                            ? 'bg-green-100 text-green-700 border border-green-300'
                            : 'bg-white text-gray-600 border border-gray-300'
                        }`}
                        onClick={() => handleToggleDoctor(doctor)}
                      >
                        <Text className="block text-xs">{doctor}</Text>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* 已选择的医生 */}
            {selectedDoctors.length > 0 && (
              <View className="bg-blue-50 rounded-lg p-3">
                <Text className="block text-xs text-gray-500 mb-2">
                  已选择 {selectedDoctors.length} 人：
                  {dutyStartDoctor && ` <span className="text-blue-600">（值班起始：${dutyStartDoctor}）</span>`}
                </Text>
                <View className="flex flex-row flex-wrap gap-2">
                  {selectedDoctors.map((doctor) => (
                    <View
                      key={doctor}
                      className={`flex flex-row items-center gap-1 px-3 py-1.5 rounded-full text-xs ${
                        doctor === dutyStartDoctor
                          ? 'bg-blue-500 text-white'
                          : 'bg-blue-200 text-blue-800'
                      }`}
                    >
                      <Text className="block text-xs">{doctor}</Text>
                      <View
                        className="ml-1 w-4 h-4 rounded-full bg-white flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveDoctor(doctor)
                        }}
                      >
                        <Text className="block text-xs text-blue-600">×</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* 操作按钮 */}
          <View className="flex flex-row gap-2 mt-2">
            <Button
              className="flex-1 bg-blue-500 text-white rounded-lg py-3"
              onClick={handleGenerateSchedule}
              disabled={loading}
            >
              {loading ? '生成中...' : '生成排班'}
            </Button>
            <Button
              className="flex-1 bg-green-500 text-white rounded-lg py-3"
              onClick={handleDownloadDoc}
              disabled={!scheduleData}
            >
              下载文档
            </Button>
          </View>
        </View>
      </View>

      {scheduleData && (
        <View className="p-4">
          {/* 科室排班表 */}
          <Text className="block text-lg font-bold mb-3">科室排班表</Text>

          {/* 值班表 */}
          <View className="bg-white rounded-lg p-4 mb-4 shadow-sm">
            <Text className="block text-base font-bold mb-3">夜间值班</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {scheduleData.dates.map((date, index) => (
                  <View key={date} className="flex flex-row items-center border-b border-gray-100 py-2">
                    <Text className="block w-32 text-sm font-medium">{scheduleData.datesWithWeek[index]}</Text>
                    <Text className="block flex-1 text-sm text-blue-600 font-semibold">
                      {scheduleData.dutySchedule[date] || '未排班'}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 白班排班表 */}
          <View className="bg-white rounded-lg p-4 mb-6 shadow-sm">
            <Text className="block text-base font-bold mb-3">白班排班（含上午/下午）</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-blue-50 p-2 border border-gray-200">
                    <Text className="block text-sm font-bold text-center">科室</Text>
                  </View>
                  {scheduleData.dates.map((date, index) => (
                    <View key={date} className="w-32 bg-blue-50 p-2 border border-gray-200">
                      <Text className="block text-xs font-bold text-center">{scheduleData.datesWithWeek[index]}</Text>
                    </View>
                  ))}
                </View>

                {/* 表格内容 */}
                {scheduleData.departments.map((department) => (
                  <View key={department} className="flex flex-row">
                    <View className="w-24 bg-gray-50 p-2 border border-gray-200">
                      <Text className="block text-sm font-medium text-center">{department}</Text>
                    </View>
                    {scheduleData.dates.map((date) => {
                      const slots = scheduleData.schedule[date]?.[department] || []
                      const slotText = slots.map(s => {
                        const suffix = s.shift === 'morning' ? '（上午）' : '（下午）'
                        return `${s.doctor}${suffix}`
                      }).join('\n')

                      return (
                        <View key={date} className="w-32 p-2 border border-gray-200 min-h-[60px] flex items-center justify-center">
                          <Text className={`text-xs text-center whitespace-pre-line ${slotText ? 'text-gray-800' : 'text-gray-400'}`}>
                            {slotText || '休息'}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 医生排班统计 */}
          <Text className="block text-lg font-bold mb-3">医生排班统计</Text>
          <View className="bg-white rounded-lg p-4 shadow-sm">
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-sm font-bold text-center">医生</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">夜班</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">上午班</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">下午班</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">休息天数</Text>
                  </View>
                </View>

                {/* 表格内容 */}
                {Object.values(scheduleData.doctorSchedule).map((info) => (
                  <View key={info.name} className="flex flex-row">
                    <View className="w-24 bg-gray-50 p-2 border border-gray-200">
                      <Text className="block text-sm font-medium text-center">{info.name}</Text>
                    </View>
                    <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                      <Text className="block text-xs">{info.nightShifts}</Text>
                    </View>
                    <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                      <Text className="block text-xs">{info.morningShifts.length}</Text>
                    </View>
                    <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                      <Text className="block text-xs">{info.afternoonShifts.length}</Text>
                    </View>
                    <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                      <Text className={`block text-xs ${info.restDays >= 2 ? 'text-green-600' : 'text-red-600'}`}>
                        {info.restDays}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View className="mt-4 text-center">
            <Text className="block text-xs text-gray-500">
              点击排班表单元格可查看详情，确认无误后点击&ldquo;下载文档&rdquo;导出Word格式
            </Text>
          </View>
        </View>
      )}
    </View>
  )
}

export default IndexPage
