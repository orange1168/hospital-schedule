import { View, Text, Input, Button, ScrollView, Picker } from '@tarojs/components'
import { useState } from 'react'
import { Network } from '@/network'
import Taro from '@tarojs/taro'
import './index.css'

interface ScheduleData {
  dates: string[]
  datesWithWeek: string[]
  departments: string[]
  schedule: Record<string, Record<string, string>>
  dutySchedule: Record<string, string>
  doctorSchedule: Record<string, Record<string, string>>
}

// 固定的医生列表
const FIXED_DOCTORS = [
  '李茜', '姜维', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎', '杨波',
  '李丹', '黄丹', '邬海燕', '罗丹', '彭粤如', '周晓宇'
]

const IndexPage = () => {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)
  const [editingCell, setEditingCell] = useState<{ date: string; department: string } | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [startDate, setStartDate] = useState('')
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([...FIXED_DOCTORS])
  const [dutyStartDoctor, setDutyStartDoctor] = useState('李茜')
  const [leaveDoctors, setLeaveDoctors] = useState<string[]>([])
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
        title: '请至少选择一个医生',
        icon: 'none'
      })
      return
    }

    setLoading(true)
    try {
      console.log('开始生成排班，起始日期:', startDate, '医生列表:', selectedDoctors, '值班起始医生:', dutyStartDoctor, '请假医生:', leaveDoctors)
      const res = await Network.request({
        url: '/api/schedule/generate',
        method: 'POST',
        data: {
          startDate,
          doctors: selectedDoctors,
          dutyStartDoctor,
          leaveDoctors
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
        title: '排班生成失败',
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
        // H5端：创建下载链接
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (Taro.getEnv() === 'h5') {
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
          // 小程序端：提示需要在H5端下载
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

  // 开始编辑单元格
  const handleCellClick = (date: string, department: string) => {
    const currentValue = scheduleData?.schedule[date]?.[department] || ''
    setEditingCell({ date, department })
    setEditingValue(currentValue)
  }

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingCell || !scheduleData) return

    setScheduleData({
      ...scheduleData,
      schedule: {
        ...scheduleData.schedule,
        [editingCell.date]: {
          ...scheduleData.schedule[editingCell.date],
          [editingCell.department]: editingValue
        }
      }
    })

    setEditingCell(null)
    setEditingValue('')
    Taro.showToast({
      title: '修改成功',
      icon: 'success'
    })
  }

  // 添加医生（从固定列表中添加）
  const handleAddDoctor = () => {
    const availableDoctors = FIXED_DOCTORS.filter(d => !selectedDoctors.includes(d))
    if (availableDoctors.length === 0) {
      Taro.showToast({
        title: '所有医生都已添加',
        icon: 'none'
      })
      return
    }

    Taro.showActionSheet({
      itemList: availableDoctors,
      success: (res) => {
        if (res.tapIndex !== undefined) {
          const doctorToAdd = availableDoctors[res.tapIndex]
          setSelectedDoctors([...selectedDoctors, doctorToAdd])
          Taro.showToast({
            title: `已添加${doctorToAdd}`,
            icon: 'success'
          })
        }
      }
    })
  }

  // 移除医生
  const handleRemoveDoctor = (doctor: string) => {
    setSelectedDoctors(selectedDoctors.filter(d => d !== doctor))
    // 如果移除的是值班起始医生，重新设置
    if (dutyStartDoctor === doctor) {
      setDutyStartDoctor(selectedDoctors[0] || '')
    }
    // 如果移除的是请假医生，从请假列表中移除
    setLeaveDoctors(leaveDoctors.filter(d => d !== doctor))
  }

  // 选择值班起始医生
  const handleSelectDutyStartDoctor = () => {
    if (selectedDoctors.length === 0) {
      Taro.showToast({
        title: '请先添加医生',
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

  // 选择请假医生
  const handleSelectLeaveDoctors = () => {
    if (selectedDoctors.length === 0) {
      Taro.showToast({
        title: '请先添加医生',
        icon: 'none'
      })
      return
    }

    Taro.showActionSheet({
      itemList: selectedDoctors,
      success: (res) => {
        if (res.tapIndex !== undefined) {
          const doctor = selectedDoctors[res.tapIndex]
          if (leaveDoctors.includes(doctor)) {
            // 取消请假
            setLeaveDoctors(leaveDoctors.filter(d => d !== doctor))
            Taro.showToast({
              title: `已取消${doctor}的请假`,
              icon: 'none'
            })
          } else {
            // 添加请假
            setLeaveDoctors([...leaveDoctors, doctor])
            Taro.showToast({
              title: `${doctor}已请假`,
              icon: 'none'
            })
          }
        }
      }
    })
  }

  // 获取医生列表（从排班数据中提取）
  const getDoctorsList = (): string[] => {
    if (!scheduleData) return []

    const doctorsSet = new Set<string>()
    Object.values(scheduleData.schedule).forEach(daySchedule => {
      Object.values(daySchedule).forEach(doctor => {
        if (doctor && doctor !== '休息') {
          doctorsSet.add(doctor)
        }
      })
    })

    // 添加值班医生
    Object.values(scheduleData.dutySchedule).forEach(doctor => {
      if (doctor) {
        doctorsSet.add(doctor)
      }
    })

    return Array.from(doctorsSet)
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
                <Text className="text-sm">{startDate || '请选择日期'}</Text>
              </Picker>
            </View>
          </View>

          {/* 值班起始医生 */}
          <View className="flex flex-row items-center gap-2">
            <Text className="block text-sm font-medium w-24">值班起始：</Text>
            <View className="flex-1 bg-blue-50 rounded-lg px-3 py-2 border border-blue-200" onClick={handleSelectDutyStartDoctor}>
              <Text className="text-sm text-blue-600">{dutyStartDoctor || '请选择'}</Text>
            </View>
          </View>

          {/* 请假医生 */}
          <View className="flex flex-row items-center gap-2">
            <Text className="block text-sm font-medium w-24">请假医生：</Text>
            <View className="flex-1 bg-red-50 rounded-lg px-3 py-2 border border-red-200" onClick={handleSelectLeaveDoctors}>
              <Text className="text-sm text-red-600">
                {leaveDoctors.length > 0 ? leaveDoctors.join('、') : '点击选择（可多选）'}
              </Text>
            </View>
          </View>

          {/* 医生列表 */}
          <View className="flex flex-col gap-2">
            <View className="flex flex-row items-center justify-between">
              <Text className="block text-sm font-medium">排班医生：</Text>
              <Button
                className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm"
                onClick={handleAddDoctor}
              >
                + 添加医生
              </Button>
            </View>

            <View className="flex flex-row flex-wrap gap-2">
              {selectedDoctors.map((doctor) => (
                <View
                  key={doctor}
                  className={`flex flex-row items-center gap-1 px-3 py-1.5 rounded-full text-xs ${
                    leaveDoctors.includes(doctor)
                      ? 'bg-red-100 text-red-600'
                      : doctor === dutyStartDoctor
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  <Text className="block text-xs">{doctor}</Text>
                  <View
                    className="ml-1 w-4 h-4 rounded-full bg-white flex items-center justify-center"
                    onClick={() => handleRemoveDoctor(doctor)}
                  >
                    <Text className="block text-xs text-gray-400">×</Text>
                  </View>
                </View>
              ))}
            </View>

            {selectedDoctors.length > 0 && (
              <View className="flex flex-col gap-1 mt-1">
                <Text className="block text-xs text-gray-500">
                  <Text className="text-blue-600">●</Text> 蓝色：值班起始医生
                </Text>
                <Text className="block text-xs text-gray-500">
                  <Text className="text-red-600">●</Text> 红色：请假医生
                </Text>
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
          {/* 第一份表格：科室排班表 */}
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
            <Text className="block text-base font-bold mb-3">白班排班</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-blue-50 p-2 border border-gray-200">
                    <Text className="block text-sm font-bold text-center">科室</Text>
                  </View>
                  {scheduleData.dates.map((date, index) => (
                    <View key={date} className="w-24 bg-blue-50 p-2 border border-gray-200">
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
                      const isEditing = editingCell?.date === date && editingCell?.department === department
                      const cellValue = scheduleData.schedule[date]?.[department] || ''

                      return (
                        <View
                          key={date}
                          className="w-24 p-2 border border-gray-200 min-h-[40px] flex items-center justify-center"
                          onClick={() => handleCellClick(date, department)}
                        >
                          {isEditing ? (
                            <View className="w-full h-8 border border-blue-500 rounded flex items-center justify-center">
                              <Input
                                className="w-full text-center text-xs bg-transparent"
                                style={{ height: '32px' }}
                                value={editingValue}
                                onInput={(e) => setEditingValue(e.detail.value)}
                                onBlur={handleSaveEdit}
                                onConfirm={handleSaveEdit}
                              />
                            </View>
                          ) : (
                            <Text className={`text-xs ${cellValue ? 'text-gray-800' : 'text-gray-400'}`}>
                              {cellValue || '休息'}
                            </Text>
                          )}
                        </View>
                      )
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 第二份表格：医生排班表 */}
          <Text className="block text-lg font-bold mb-3">医生排班表</Text>
          <View className="bg-white rounded-lg p-4 shadow-sm">
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-sm font-bold text-center">医生</Text>
                  </View>
                  {scheduleData.dates.map((date, index) => (
                    <View key={date} className="w-24 bg-green-50 p-2 border border-gray-200">
                      <Text className="block text-xs font-bold text-center">{scheduleData.datesWithWeek[index]}</Text>
                    </View>
                  ))}
                </View>

                {/* 表格内容 */}
                {getDoctorsList().map((doctor) => (
                  <View key={doctor} className="flex flex-row">
                    <View className="w-24 bg-gray-50 p-2 border border-gray-200">
                      <Text className="block text-sm font-medium text-center">{doctor}</Text>
                    </View>
                    {scheduleData.dates.map((date) => {
                      // 查找该医生当天的科室
                      const department = Object.entries(scheduleData.schedule[date] || {})
                        .find(([_, doc]) => doc === doctor)?.[0] || null

                      // 检查是否是值班
                      const isDuty = scheduleData.dutySchedule[date] === doctor

                      let cellText = '休息'
                      let cellClass = 'text-gray-400'

                      if (isDuty) {
                        cellText = '值班'
                        cellClass = 'text-blue-600 font-semibold'
                      } else if (department) {
                        cellText = department
                        cellClass = 'text-gray-800'
                      }

                      return (
                        <View key={date} className="w-24 p-2 border border-gray-200 min-h-[40px] flex items-center justify-center">
                          <Text className={`text-xs ${cellClass}`}>{cellText}</Text>
                        </View>
                      )
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View className="mt-4 text-center">
            <Text className="block text-xs text-gray-500">
              点击科室排班表的单元格可修改医生，确认无误后点击&quot;下载文档&quot;导出Word格式
            </Text>
          </View>
        </View>
      )}
    </View>
  )
}

export default IndexPage
