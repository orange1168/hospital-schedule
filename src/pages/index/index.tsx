import { View, Text, Input, Button, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import { Network } from '@/network'
import Taro from '@tarojs/taro'
import './index.css'

interface ScheduleData {
  dates: string[]
  departments: string[]
  schedule: Record<string, Record<string, string>>
  dutySchedule: Record<string, string>
}

const IndexPage = () => {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)
  const [editingCell, setEditingCell] = useState<{ date: string; department: string } | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [startDate, setStartDate] = useState('')
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

    setLoading(true)
    try {
      console.log('开始生成排班，起始日期:', startDate)
      const res = await Network.request({
        url: '/api/schedule/generate',
        method: 'POST',
        data: { startDate }
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

  return (
    <View className="min-h-screen bg-gray-50">
      <View className="bg-white p-4 sticky top-0 z-10 shadow-sm">
        <Text className="block text-xl font-bold text-center mb-4">医院排班系统</Text>

        <View className="flex flex-col gap-3">
          <View className="flex flex-row items-center gap-2">
            <Text className="block text-sm font-medium w-24">开始日期：</Text>
            <View className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
              <Input
                className="w-full bg-transparent text-sm"
                value={startDate}
                placeholder="请选择日期 (YYYY-MM-DD)"
                onInput={(e) => setStartDate(e.detail.value)}
              />
            </View>
          </View>

          <View className="flex flex-row gap-2">
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
          <Text className="block text-lg font-bold mb-3">排班表</Text>

          {/* 值班表 */}
          <View className="bg-white rounded-lg p-4 mb-4 shadow-sm">
            <Text className="block text-base font-bold mb-3">夜间值班</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {scheduleData.dates.map((date) => (
                  <View key={date} className="flex flex-row items-center border-b border-gray-100 py-2">
                    <Text className="block w-24 text-sm font-medium">{date}</Text>
                    <Text className="block flex-1 text-sm text-blue-600 font-semibold">
                      {scheduleData.dutySchedule[date] || '未排班'}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 白班排班表 */}
          <View className="bg-white rounded-lg p-4 shadow-sm">
            <Text className="block text-base font-bold mb-3">白班排班</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-blue-50 p-2 border border-gray-200">
                    <Text className="block text-sm font-bold text-center">科室</Text>
                  </View>
                  {scheduleData.dates.map((date) => (
                    <View key={date} className="w-20 bg-blue-50 p-2 border border-gray-200">
                      <Text className="block text-xs font-bold text-center">{date}</Text>
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
                          className="w-20 p-2 border border-gray-200 min-h-[40px] flex items-center justify-center"
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

          <View className="mt-4 text-center">
            <Text className="block text-xs text-gray-500">
              点击单元格可修改医生，确认无误后点击&quot;下载文档&quot;导出Word格式
            </Text>
          </View>
        </View>
      )}
    </View>
  )
}

export default IndexPage
