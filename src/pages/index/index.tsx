import { View, Text, Button, ScrollView, Picker } from '@tarojs/components'
import { useState, useEffect } from 'react'
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

// 科室列表
const DEPARTMENTS = [
  '1诊室', '2诊室', '4诊室', '5诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿4', '妇儿前', 'VIP/男2', '男3', '女2'
]

const IndexPage = () => {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)

  const [startDate, setStartDate] = useState('')
  const [dutyStartDoctor, setDutyStartDoctor] = useState<string>('')
  const [showDutyStartPicker, setShowDutyStartPicker] = useState(false)
  const [loading, setLoading] = useState(false)

  // 获取下周一
  const getNextMonday = (): string => {
    const now = new Date()
    const dayOfWeek = now.getDay() // 0=周日, 1=周一, ..., 6=周六
    // 计算到下周一的天数
    // 周日(0) -> 1天，周一(1) -> 7天，周二(2) -> 6天，...，周六(6) -> 2天
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek)
    const nextMonday = new Date(now)
    nextMonday.setDate(now.getDate() + daysUntilNextMonday)
    return nextMonday.toISOString().split('T')[0] // 返回 YYYY-MM-DD 格式
  }

  // 初始化默认值
  useEffect(() => {
    setStartDate(getNextMonday())
    setDutyStartDoctor('李茜')
  }, [])

  // 请假相关状态
  const [showLeaveSelector, setShowLeaveSelector] = useState(false)
  const [leaveRecords, setLeaveRecords] = useState<Array<{ doctor: string; dates: string[] }>>([])
  const [currentLeaveDoctor, setCurrentLeaveDoctor] = useState('')
  const [currentLeaveDates, setCurrentLeaveDates] = useState<string[]>([])

  // 固定排班相关状态
  const [showFixedSchedule, setShowFixedSchedule] = useState(false)
  const [fixedSchedule, setFixedSchedule] = useState<Record<string, Record<string, string>>>({})

  // 排班修改相关状态
  const [showCellEditModal, setShowCellEditModal] = useState(false)
  const [editingCell, setEditingCell] = useState<{ doctor: string; date: string } | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState('')

  // 处理单元格点击
  const handleCellClick = (doctor: string, date: string) => {
    const schedule = scheduleData?.doctorSchedule[doctor]
    if (!schedule) return

    const department = (schedule as any)?.departmentsByDate?.[date]
    const hasNightShift = (schedule as any)?.nightShiftsByDate?.[date]

    // 值班医生不能修改
    if (hasNightShift) {
      Taro.showToast({
        title: '值班医生不能修改',
        icon: 'none'
      })
      return
    }

    setEditingCell({ doctor, date })
    setSelectedDepartment(department || '休息')
    setShowCellEditModal(true)
  }

  // 处理科室/休息选择，自动保存并关闭
  const handleDepartmentSelect = (department: string) => {
    if (!editingCell || !scheduleData) return

    const { doctor, date } = editingCell
    const newScheduleData = { ...scheduleData }
    const doctorInfo = newScheduleData.doctorSchedule[doctor]

    // 更新医生的排班信息
    if (doctorInfo) {
      const oldShift = doctorInfo.shifts[date]

      // 重新计算统计数据
      if (department === '休息') {
        doctorInfo.shifts[date] = 'off'
        ;(doctorInfo as any).departmentsByDate[date] = '休息'

        // 如果原来是上班，减少上班天数，增加休息天数
        if (oldShift === 'morning') {
          ;(doctorInfo as any).morningShiftDays = ((doctorInfo as any).morningShiftDays || 0) - 1
          ;(doctorInfo as any).afternoonShiftDays = ((doctorInfo as any).afternoonShiftDays || 0) - 1
          doctorInfo.restDays = (doctorInfo.restDays || 0) + 1
        }
      } else {
        doctorInfo.shifts[date] = 'morning'
        ;(doctorInfo as any).departmentsByDate[date] = department

        // 如果原来是休息，增加上班天数，减少休息天数
        if (oldShift === 'off' || !oldShift) {
          ;(doctorInfo as any).morningShiftDays = ((doctorInfo as any).morningShiftDays || 0) + 1
          ;(doctorInfo as any).afternoonShiftDays = ((doctorInfo as any).afternoonShiftDays || 0) + 1
          doctorInfo.restDays = (doctorInfo.restDays || 0) - 1
        }
      }
    }

    // 更新科室排班表（删除旧的，添加新的）
    Object.keys(newScheduleData.schedule[date]).forEach(dept => {
      newScheduleData.schedule[date][dept] = newScheduleData.schedule[date][dept].filter(
        slot => slot.doctor !== doctor || slot.shift !== 'morning' && slot.shift !== 'afternoon'
      )
    })

    if (department !== '休息') {
      newScheduleData.schedule[date][department].push({
        doctor,
        shift: 'morning',
        department
      })
      newScheduleData.schedule[date][department].push({
        doctor,
        shift: 'afternoon',
        department
      })
    }

    setScheduleData(newScheduleData)
    setShowCellEditModal(false)
    setEditingCell(null)
    setSelectedDepartment('')

    Taro.showToast({
      title: '修改成功',
      icon: 'success'
    })
  }

  // 生成排班
  const handleGenerateSchedule = async () => {
    if (!startDate) {
      Taro.showToast({
        title: '请选择开始日期',
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
      console.log('开始生成排班，参数:', { startDate, dutyStartDoctor, leaveRecords, fixedSchedule })
      const res = await Network.request({
        url: '/api/schedule/generate',
        method: 'POST',
        data: {
          startDate,
          dutyStartDoctor,
          leaveRequests: leaveRecords,
          fixedSchedule
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

  // 选择值班起始医生
  const handleSelectDutyStartDoctor = () => {
    setShowDutyStartPicker(true)
  }

  // 选择值班起始医生的确认
  const handleConfirmDutyStartDoctor = (e) => {
    const index = e.detail.value
    if (index !== undefined && index >= 0) {
      setDutyStartDoctor(FIXED_DOCTORS[index])
    }
    setShowDutyStartPicker(false)
  }

  // 添加请假记录
  const handleAddLeaveRecord = () => {
    if (!currentLeaveDoctor) {
      Taro.showToast({
        title: '请选择请假医生',
        icon: 'none'
      })
      return
    }

    if (currentLeaveDates.length === 0) {
      Taro.showToast({
        title: '请至少选择一个请假日期',
        icon: 'none'
      })
      return
    }

    setLeaveRecords([...leaveRecords, {
      doctor: currentLeaveDoctor,
      dates: [...currentLeaveDates]
    }])

    setCurrentLeaveDoctor('')
    setCurrentLeaveDates([])

    Taro.showToast({
      title: '请假记录添加成功',
      icon: 'success'
    })
  }

  // 移除请假记录
  const handleRemoveLeaveRecord = (index: number) => {
    setLeaveRecords(leaveRecords.filter((_, i) => i !== index))
  }

  // 清空固定排班
  const handleClearFixedSchedule = () => {
    setFixedSchedule({})
    Taro.showToast({
      title: '固定排班已清空',
      icon: 'success'
    })
  }

  // 获取日期列表
  const getDates = (): string[] => {
    if (!startDate) return []
    const dates: string[] = []
    const start = new Date(startDate)

    for (let i = 0; i < 7; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      dates.push(date.toISOString().split('T')[0])
    }

    return dates
  }

  // 获取日期和星期
  const getDateWithWeek = (date: string): string => {
    const dateObj = new Date(date)
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const dayOfWeek = dateObj.getDay()

    return `${date.split('-')[1]}-${date.split('-')[2]} ${dayNames[dayOfWeek]}`
  }

  return (
    <ScrollView scrollY className="h-screen bg-gray-50">
      <View className="bg-white p-4 mb-4 shadow-sm">
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

          {/* 固定医生列表 */}
          <View className="flex flex-col gap-2 mt-2">
            <Text className="block text-sm font-medium text-gray-700">排班医生：</Text>
            <View className="bg-gray-50 rounded-lg p-3">
              <Text className="block text-xs text-gray-600 mb-2">14位固定医生：</Text>
              <View className="flex flex-row flex-wrap gap-2">
                {FIXED_DOCTORS.map((doctor) => (
                  <View
                    key={doctor}
                    className={`px-2 py-1 rounded text-xs ${
                      doctor === dutyStartDoctor
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-white text-gray-600 border border-gray-300'
                    }`}
                  >
                    <Text className="block text-xs">{doctor}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* 值班起始医生 */}
          <View className="flex flex-row items-center gap-2 mt-2">
            <Text className="block text-sm font-medium w-24">值班起始：</Text>
            {showDutyStartPicker ? (
              <Picker
                mode="selector"
                range={FIXED_DOCTORS}
                value={FIXED_DOCTORS.indexOf(dutyStartDoctor)}
                onChange={handleConfirmDutyStartDoctor}
                onCancel={() => setShowDutyStartPicker(false)}
              >
                <View
                  className="flex-1 bg-blue-100 rounded-lg px-3 py-2.5 border border-blue-300"
                >
                  <Text className="block text-sm text-blue-700">{dutyStartDoctor || '选择中...'}</Text>
                </View>
              </Picker>
            ) : (
              <View
                className="flex-1 bg-blue-50 rounded-lg px-3 py-2.5 border border-blue-200 active:bg-blue-100"
                onTap={(e) => {
                  e.stopPropagation()
                  handleSelectDutyStartDoctor()
                }}
              >
                <Text className="block text-sm text-blue-600">{dutyStartDoctor || '点击选择'}</Text>
              </View>
            )}
          </View>

          {/* 固定排班设置 */}
          <View className="mt-4 bg-blue-50 rounded-lg p-3">
            <View className="flex flex-row items-center justify-between mb-2">
              <Text className="block text-sm font-medium">固定排班设置：</Text>
              <View className="flex flex-row gap-2">
                {Object.keys(fixedSchedule).length > 0 && (
                  <Button
                    className="px-3 py-1 bg-red-500 text-white rounded text-xs"
                    onTap={handleClearFixedSchedule}
                  >
                    清空
                  </Button>
                )}
                <Button
                  className="px-3 py-1 bg-blue-500 text-white rounded text-xs"
                  onTap={() => setShowFixedSchedule(!showFixedSchedule)}
                >
                  {showFixedSchedule ? '隐藏' : '设置'}
                </Button>
              </View>
            </View>

            {showFixedSchedule && (
              <View className="flex flex-col gap-2">
                <Text className="block text-xs text-gray-600">
                  手动设置固定排班，系统将基于您的设置自动填充剩余班次
                </Text>

                {/* 显示日期列表，每个日期下显示医生选择器 */}
                {startDate && (
                  <View className="mt-2">
                    {getDates().map((dateStr) => {
                      const displayDate = getDateWithWeek(dateStr)
                      return (
                        <View key={dateStr} className="bg-white rounded-lg p-3 mb-2">
                          <Text className="block text-sm font-medium mb-2">{displayDate}</Text>
                          <View className="flex flex-col gap-2">
                            {FIXED_DOCTORS.map((doctor) => {
                              const fixedValue = fixedSchedule[dateStr]?.[doctor]
                              return (
                                <View key={`${dateStr}-${doctor}`} className="flex flex-row items-center gap-2">
                                  <Text className="block text-xs w-16">{doctor}</Text>
                                  <View className="flex-1">
                                    <Picker
                                      mode="selector"
                                      range={['未设置', ...['休息', ...DEPARTMENTS]]}
                                      value={fixedValue ? (fixedValue === '休息' ? 1 : ['休息', ...DEPARTMENTS].indexOf(fixedValue) + 1) : 0}
                                      onChange={(e) => {
                                        const index = Number(e.detail.value)
                                        if (index === 0) {
                                          // 未设置，删除
                                          setFixedSchedule(prev => {
                                            const newSchedule = { ...prev }
                                            if (newSchedule[dateStr]?.[doctor]) {
                                              delete newSchedule[dateStr][doctor]
                                              if (Object.keys(newSchedule[dateStr]).length === 0) {
                                                delete newSchedule[dateStr]
                                              }
                                            }
                                            return newSchedule
                                          })
                                        } else {
                                          const value = ['未设置', ...['休息', ...DEPARTMENTS]][index]
                                          setFixedSchedule(prev => ({
                                            ...prev,
                                            [dateStr]: {
                                              ...prev[dateStr],
                                              [doctor]: value
                                            }
                                          }))
                                        }
                                      }}
                                    >
                                      <View className={`bg-gray-50 rounded px-3 py-2 ${fixedValue ? (fixedValue === '休息' ? 'bg-red-50' : 'bg-green-50') : ''}`}>
                                        <Text className={`block text-xs ${fixedValue ? (fixedValue === '休息' ? 'text-red-600' : 'text-green-600') : ''}`}>
                                          {fixedValue || '点击设置'}
                                        </Text>
                                      </View>
                                    </Picker>
                                  </View>
                                </View>
                              )
                            })}
                          </View>
                        </View>
                      )
                    })}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* 请假设置 */}
          <View className="mt-4 bg-yellow-50 rounded-lg p-3">
            <View className="flex flex-row items-center justify-between mb-2">
              <Text className="block text-sm font-medium">请假设置：</Text>
              <Button
                className="px-3 py-1 bg-yellow-500 text-white rounded text-xs"
                onTap={() => setShowLeaveSelector(!showLeaveSelector)}
              >
                {showLeaveSelector ? '隐藏' : '显示'}
              </Button>
            </View>

            {showLeaveSelector && (
              <View className="flex flex-col gap-2">
                {/* 选择请假医生 */}
                <View className="flex flex-row items-center gap-2">
                  <Text className="block text-xs w-16">请假医生：</Text>
                  <View className="flex-1 bg-white rounded px-3 py-2">
                    <Picker
                      mode="selector"
                      range={['无', ...FIXED_DOCTORS]}
                      value={FIXED_DOCTORS.indexOf(currentLeaveDoctor) + 1}
                      onChange={(e) => {
                        const index = Number(e.detail.value)
                        if (index === 0) {
                          setCurrentLeaveDoctor('')
                        } else {
                          setCurrentLeaveDoctor(FIXED_DOCTORS[index - 1])
                        }
                      }}
                    >
                      <Text className="block text-xs">{currentLeaveDoctor || '请选择'}</Text>
                    </Picker>
                  </View>
                </View>

                {/* 请假日期 */}
                <View className="flex flex-col gap-2">
                  <Text className="block text-xs">请假日期：</Text>
                  {currentLeaveDates.map((date, index) => (
                    <View key={index} className="flex flex-row gap-2 items-center">
                      <View className="flex-1 bg-white rounded px-3 py-2">
                        <Picker
                          mode="date"
                          value={date}
                          onChange={(e) => {
                            const newDates = [...currentLeaveDates]
                            newDates[index] = e.detail.value
                            setCurrentLeaveDates(newDates)
                          }}
                        >
                          <Text className="block text-xs">{date || '请选择日期'}</Text>
                        </Picker>
                      </View>
                      <Button
                        className="px-3 py-1 bg-red-500 text-white rounded text-xs"
                        onTap={() => {
                          const newDates = currentLeaveDates.filter((_, i) => i !== index)
                          setCurrentLeaveDates(newDates)
                        }}
                      >
                        删除
                      </Button>
                    </View>
                  ))}
                  <Button
                    className="px-3 py-1 bg-gray-500 text-white rounded text-xs"
                    onTap={() => {
                      if (!startDate) {
                        Taro.showToast({ title: '请先选择开始日期', icon: 'none' })
                        return
                      }
                      setCurrentLeaveDates([...currentLeaveDates, startDate])
                    }}
                  >
                    + 添加请假日期
                  </Button>
                </View>

                {/* 添加请假记录按钮 */}
                <Button
                  className="px-3 py-2 bg-green-500 text-white rounded text-xs"
                  onTap={handleAddLeaveRecord}
                >
                  + 添加请假记录
                </Button>

                {/* 已添加的请假记录 */}
                {leaveRecords.length > 0 && (
                  <View className="mt-2">
                    <Text className="block text-xs text-gray-600 mb-2">已添加的请假记录：</Text>
                    {leaveRecords.map((record, index) => (
                      <View key={index} className="flex flex-row items-center justify-between bg-white p-2 rounded mb-1">
                        <View className="flex-1">
                          <Text className="block text-xs">
                            <Text className="font-semibold">{record.doctor}</Text>
                            {' '}：{record.dates.join('、')}
                          </Text>
                        </View>
                        <Button
                          className="px-2 py-1 bg-red-500 text-white rounded text-xs"
                          onTap={() => handleRemoveLeaveRecord(index)}
                        >
                          删除
                        </Button>
                      </View>
                    ))}
                  </View>
                )}
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
              onTap={handleDownloadDoc}
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

                      // 优化显示：如果上下午是同一个医生，只显示一次名字
                      let slotText = ''
                      if (slots.length === 0) {
                        slotText = '休息'
                      } else if (slots.length === 1) {
                        const suffix = slots[0].shift === 'morning' ? '（上午）' : '（下午）'
                        slotText = `${slots[0].doctor}${suffix}`
                      } else if (slots.length === 2) {
                        // 如果两个班次的医生相同，只显示一次
                        if (slots[0].doctor === slots[1].doctor) {
                          slotText = slots[0].doctor
                        } else {
                          // 否则分别显示
                          slotText = slots.map(s => {
                            const suffix = s.shift === 'morning' ? '（上午）' : '（下午）'
                            return `${s.doctor}${suffix}`
                          }).join('\n')
                        }
                      }

                      return (
                        <View key={date} className="w-32 p-2 border border-gray-200 min-h-[60px] flex items-center justify-center">
                          <Text className={`text-xs text-center whitespace-pre-line ${slotText && slotText !== '休息' ? 'text-gray-800' : 'text-gray-400'}`}>
                            {slotText}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 医生排班表 */}
          <Text className="block text-lg font-bold mb-3 mt-6">医生排班表</Text>
          <View className="bg-white rounded-lg p-4 mb-6 shadow-sm">
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-purple-50 p-2 border border-gray-200">
                    <Text className="block text-sm font-bold text-center">医生</Text>
                  </View>
                  {scheduleData.dates.map((date, index) => (
                    <View key={date} className="w-24 bg-purple-50 p-2 border border-gray-200">
                      <Text className="block text-xs font-bold text-center">{scheduleData.datesWithWeek[index].split(' ')[0]}</Text>
                      <Text className="block text-xs text-center text-gray-500">{scheduleData.datesWithWeek[index].split(' ')[1]}</Text>
                    </View>
                  ))}
                </View>

                {/* 表格内容 */}
                {FIXED_DOCTORS.map((doctor) => {
                  const schedule = scheduleData.doctorSchedule[doctor]
                  return (
                    <View key={doctor} className="flex flex-row">
                      <View className="w-24 bg-gray-50 p-2 border border-gray-200">
                        <Text className="block text-sm font-medium text-center">{doctor}</Text>
                      </View>
                      {scheduleData.dates.map((date) => {
                        const shift = schedule?.shifts[date]
                        const department = (schedule as any)?.departmentsByDate?.[date]
                        const hasNightShift = (schedule as any)?.nightShiftsByDate?.[date]
                        const isFixed = fixedSchedule[date]?.[doctor] // 检查是否为固定排班
                        let shiftText = ''
                        let shiftColor = 'text-gray-400'

                        // 显示逻辑：值班是独立状态
                        if (hasNightShift) {
                          shiftText = '值班'
                          shiftColor = 'text-red-600'
                        } else if (shift === 'morning') {
                          shiftText = department || '休息'
                          shiftColor = isFixed ? 'text-orange-600' : 'text-blue-600' // 固定排班用橙色
                        } else {
                          shiftText = '休息'
                          shiftColor = isFixed ? 'text-orange-600' : 'text-gray-400' // 固定排班用橙色
                        }

                        return (
                          <View
                            key={date}
                            className={`w-24 p-2 border border-gray-200 min-h-[50px] flex items-center justify-center ${!hasNightShift ? 'cursor-pointer active:bg-blue-50' : ''}`}
                            onTap={() => !hasNightShift && handleCellClick(doctor, date)}
                          >
                            <Text className={`text-xs text-center ${shiftColor}`}>
                              {shiftText}
                            </Text>
                          </View>
                        )
                      })}
                    </View>
                  )
                })}
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
                    <Text className="block text-xs font-bold text-center">上午班(天)</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">下午班(天)</Text>
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
                      <Text className="block text-xs">{(info as any).morningShiftDays || info.morningShifts.length}</Text>
                    </View>
                    <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                      <Text className="block text-xs">{(info as any).afternoonShiftDays || info.afternoonShifts.length}</Text>
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

          <View className="mt-4 mb-20 text-center">
            <Text className="block text-xs text-gray-500">
              点击排班表单元格可查看详情，确认无误后点击&ldquo;下载文档&rdquo;导出Word格式
            </Text>
          </View>
        </View>
      )}

      {/* 科室/休息选择弹窗 */}
      {showCellEditModal && editingCell && (
        <View className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <View className="bg-white rounded-lg p-6 mx-4 w-80">
            <Text className="block text-lg font-bold mb-4 text-center">
              修改排班
            </Text>
            <View className="mb-4">
              <Text className="block text-sm text-gray-600 mb-2">
                医生：{editingCell.doctor}
              </Text>
              <Text className="block text-sm text-gray-600 mb-4">
                日期：{editingCell.date}
              </Text>
              <Text className="block text-sm text-gray-600 mb-2">
                选择科室或休息：
              </Text>
              <View className="flex flex-col gap-2">
                <View
                  className={`w-full p-3 border rounded-lg text-center ${selectedDepartment === '休息' ? 'bg-red-50 border-red-500' : 'border-gray-300'}`}
                  onTap={() => handleDepartmentSelect('休息')}
                >
                  <Text className={`block text-sm ${selectedDepartment === '休息' ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                    休息
                  </Text>
                </View>
                {scheduleData?.departments.map((dept) => (
                  <View
                    key={dept}
                    className={`w-full p-3 border rounded-lg text-center ${selectedDepartment === dept ? 'bg-blue-50 border-blue-500' : 'border-gray-300'}`}
                    onTap={() => handleDepartmentSelect(dept)}
                  >
                    <Text className={`block text-sm ${selectedDepartment === dept ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                      {dept}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <View className="flex gap-3">
              <View
                className="flex-1 bg-gray-200 text-gray-700 rounded-lg py-3 text-center cursor-pointer"
                onTap={() => {
                  setShowCellEditModal(false)
                  setEditingCell(null)
                  setSelectedDepartment('')
                }}
              >
                <Text className="block text-sm font-medium">取消</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  )
}

export default IndexPage
