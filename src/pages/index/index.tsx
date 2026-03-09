import { View, Text, Button, ScrollView, Picker, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import { Network } from '@/network'
import Taro from '@tarojs/taro'
import DepartmentSelector from '@/components/DepartmentSelector'
import './index.css'

interface ScheduleData {
  dates: string[]
  datesWithWeek: string[]
  departments: string[]
  schedule: Record<string, Record<string, Array<{ doctor: string; shift: 'morning' | 'afternoon' | 'night' | 'off'; department?: string }>>>
  dutySchedule: Record<string, string>
  doctorSchedule: Record<string, {
    name: string
    shifts: Record<string, {
      morning: 'work' | 'off' | 'night'
      afternoon: 'work' | 'off' | 'night'
    }>
    nightShiftsByDate: Record<string, boolean>
    departmentsByDate: {
      morning: string
      afternoon: string
    }
    morningShifts: string[]
    afternoonShifts: string[]
    nightShifts: number
    restDays: number
  }>
  useHalfDay: boolean
}

// 固定的医生列表
const FIXED_DOCTORS = [
  '杨波', '李丹', '黄丹', '李茜', '陈晓林', '高玲', '曹钰', '朱朝霞', '范冬黎',
  '周晓宇', '彭粤如', '万佳乐', '姜维', '罗丹', '杨飞娇', '蓝觅', '李卓', '蔡忠凤', '邓旦'
]

// 完整的科室列表
const DEPARTMENTS = [
  '1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男1', '男2', '男3', '女1', '女2', '女3'
]

// 🔴 医生排班表选择的科室列表（不包括1诊室，因为1诊室是值班科室）
const DOCTOR_DEPARTMENTS = [
  '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '9诊室', '10诊室',
  '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男1', '男2', '男3', '女1', '女2', '女3'
]

const IndexPage = () => {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('') // 🔴 新增：结束日期
  const [selectedDutyDoctors, setSelectedDutyDoctors] = useState<string[]>([]) // 用户选择的值班医生列表
  const [loading, setLoading] = useState(false)

  // 科室选择相关状态
  const [showDepartmentSelector, setShowDepartmentSelector] = useState(false)
  const [selectedDepartments, setSelectedDepartments] = useState<{
    Monday: string[]
    Tuesday: string[]
    Wednesday: string[]
    Thursday: string[]
    Friday: string[]
    Saturday: string[]
    Sunday: string[]
  }>({
    Monday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '10诊室', '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男2', '女2', '女3'],
    Tuesday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '10诊室', '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男2', '女2', '女3'],
    Wednesday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '10诊室', '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男2', '女2', '女3'],
    Thursday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '10诊室', '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男2', '女2', '女3'],
    Friday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）', '特需诊室', '10诊室', '妇儿2', '妇儿3', '妇儿4', 'VIP2', '男2', '女2', '女3'],
    Saturday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）'],
    Sunday: ['1诊室', '3诊室', '4诊室', '5诊室（床旁+术中）']
  })

  // 获取下周一
  const getNextMonday = (): string => {
    const now = new Date()
    const dayOfWeek = now.getDay() // 0=周日, 1=周一, ..., 6=周六
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek)
    const nextMonday = new Date(now)
    nextMonday.setDate(now.getDate() + daysUntilNextMonday)
    return nextMonday.toISOString().split('T')[0]
  }

  // 🔴 修改：获取给定日期所在周的周日
  const getSundayOfWeek = (dateStr: string): string => {
    const date = new Date(dateStr)
    const dayOfWeek = date.getDay() // 0=周日, 1=周一, ..., 6=周六
    const daysUntilSunday = dayOfWeek === 0 ? 0 : (7 - dayOfWeek)
    const sunday = new Date(date)
    sunday.setDate(date.getDate() + daysUntilSunday)
    return sunday.toISOString().split('T')[0]
  }

  // 初始化默认值
  useEffect(() => {
    const nextMonday = getNextMonday()
    const sundayOfWeek = getSundayOfWeek(nextMonday)
    setStartDate(nextMonday)
    setEndDate(sundayOfWeek)
  }, [])

  // 当 startDate 或 endDate 改变时，初始化空排班数据结构
  useEffect(() => {
    if (startDate && endDate) {
      initializeEmptySchedule()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate])

  // 排班修改相关状态
  const [showCellEditModal, setShowCellEditModal] = useState(false)
  const [showDoctorSelector, setShowDoctorSelector] = useState(false)
  const [editingCell, setEditingCell] = useState<{ type: 'department' | 'doctor' | 'night_doctor'; key1: string; key2: string; key3?: string } | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [selectedDoctor, setSelectedDoctor] = useState('')
  const [selectedShiftType, setSelectedShiftType] = useState<'full' | 'morning' | 'afternoon'>('full')

  // 🔴 夜班医生列表（二线夜可选医生）
  const NIGHT_DOCTORS = ['罗丹', '李茜', '高玲']

  // 获取日期列表（🔴 修改：支持动态天数）
  const getDates = (): string[] => {
    if (!startDate || !endDate) return []
    const dates: string[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    // 计算天数差
    const diffTime = end.getTime() - start.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1

    // 🔴 限制最大14天
    const maxDays = Math.min(diffDays, 14)

    for (let i = 0; i < maxDays; i++) {
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

  // 初始化空排班数据结构
  const initializeEmptySchedule = () => {
    if (!startDate) return

    const dates = getDates()
    const datesWithWeek = dates.map(date => getDateWithWeek(date))

    // 初始化排班表结构
    const schedule: Record<string, Record<string, Array<{ doctor: string; shift: 'morning' | 'afternoon' | 'night' | 'off'; department?: string }>>> = {}
    dates.forEach(date => {
      schedule[date] = {}
      DEPARTMENTS.forEach(dept => {
        schedule[date][dept] = []
      })
    })

    const dutySchedule: Record<string, string> = {}

    // 排除邓旦医生的列表（用于排班）
    const doctorsForSchedule = FIXED_DOCTORS.filter(doctor => doctor !== '邓旦')

    // 初始化医生排班记录
    const doctorSchedule: Record<string, any> = {}
    doctorsForSchedule.forEach(doctor => {
      doctorSchedule[doctor] = {
        name: doctor,
        shifts: {},
        nightShiftsByDate: {},
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        nightShifts: 0,
        restDays: 0
      }
      dates.forEach(date => {
        doctorSchedule[doctor].shifts[date] = {
          morning: 'off',
          afternoon: 'off'
        }
        doctorSchedule[doctor].departmentsByDate[date] = {
          morning: '请输入',
          afternoon: '请输入'
        }
      })
    })

    // 添加邓旦医生（不排班，只显示）
    doctorSchedule['邓旦'] = {
      name: '邓旦',
      shifts: {},
      nightShiftsByDate: {},
      departmentsByDate: {},
      morningShifts: [],
      afternoonShifts: [],
      nightShifts: 0,
      restDays: 0,
      isDirector: true // 标记为科室主任
    }
    dates.forEach(date => {
      doctorSchedule['邓旦'].shifts[date] = {
        morning: 'off',
        afternoon: 'off'
      }
      doctorSchedule['邓旦'].departmentsByDate[date] = {
        morning: '',
        afternoon: ''
      }
    })

    // 添加特殊行（一线夜、二线夜、三线夜、补休、其他）
    const specialRows = ['一线夜', '二线夜', '三线夜', '补休', '其他']
    specialRows.forEach(rowName => {
      doctorSchedule[rowName] = {
        name: rowName,
        shifts: {},
        nightShiftsByDate: {},
        departmentsByDate: {},
        morningShifts: [],
        afternoonShifts: [],
        nightShifts: 0,
        restDays: 0,
        isSpecialRow: true // 标记为特殊行
      }
      dates.forEach(date => {
        doctorSchedule[rowName].shifts[date] = {
          morning: 'off',
          afternoon: 'off'
        }
        doctorSchedule[rowName].departmentsByDate[date] = {
          morning: rowName === '三线夜' ? '邓旦' : '',
          afternoon: ''
        }
      })
    })

    setScheduleData({
      dates,
      datesWithWeek,
      departments: DEPARTMENTS,
      schedule,
      dutySchedule,
      doctorSchedule,
      useHalfDay: false
    })
  }

  // 更新值班医生排班和一线夜
  const updateDutySchedule = () => {
    if (!scheduleData || !scheduleData.dates) {
      return
    }

    const newScheduleData = JSON.parse(JSON.stringify(scheduleData))
    const dates = scheduleData.dates

    // 清除所有医生的值班标记和排班信息
    Object.values(newScheduleData.doctorSchedule).forEach((doctorInfo: any) => {
      if (!doctorInfo.isDirector && !doctorInfo.isSpecialRow) {
        if (doctorInfo.nightShiftsByDate) {
          Object.keys(doctorInfo.nightShiftsByDate).forEach((date: string) => {
            delete doctorInfo.nightShiftsByDate[date]
          })
        }
        doctorInfo.nightShiftsByDate = {}
        doctorInfo.nightShifts = 0

        dates.forEach((date: string) => {
          const dept = doctorInfo.departmentsByDate[date]
          if (dept?.morning === '1诊室' || dept?.afternoon === '1诊室') {
            newScheduleData.schedule[date]['1诊室'] = newScheduleData.schedule[date]['1诊室'].filter(
              (slot: any) => slot.doctor !== doctorInfo.name
            )
            if (dept?.morning === '1诊室') {
              dept.morning = '请输入'
              if (doctorInfo.shifts[date]) {
                doctorInfo.shifts[date].morning = 'off'
              }
              if ((doctorInfo as any).morningShiftDays && (doctorInfo as any).morningShiftDays > 0) {
                (doctorInfo as any).morningShiftDays -= 0.5
                doctorInfo.restDays = (doctorInfo.restDays || 0) + 0.5
              }
            }
            if (dept?.afternoon === '1诊室') {
              dept.afternoon = '请输入'
              if (doctorInfo.shifts[date]) {
                doctorInfo.shifts[date].afternoon = 'off'
              }
              if ((doctorInfo as any).afternoonShiftDays && (doctorInfo as any).afternoonShiftDays > 0) {
                (doctorInfo as any).afternoonShiftDays -= 0.5
                doctorInfo.restDays = (doctorInfo.restDays || 0) + 0.5
              }
            }
          }
        })

        dates.forEach((date: string) => {
          if (newScheduleData.dutySchedule[date] === doctorInfo.name) {
            newScheduleData.dutySchedule[date] = ''
          }
        })
      }
    })

    // 清除一线夜的填充
    const firstNightShiftInfo = newScheduleData.doctorSchedule['一线夜']
    if (firstNightShiftInfo) {
      dates.forEach((date: string) => {
        firstNightShiftInfo.departmentsByDate[date] = {
          morning: '',
          afternoon: ''
        }
      })
    }

    // 🔴 修改：自动填充值班医生到医生排班表（1诊室值班，支持循环分配）
    selectedDutyDoctors.forEach((doctor, index) => {
      // 使用取模运算实现循环分配
      const date = dates[index % dates.length]
      const doctorInfo = newScheduleData.doctorSchedule[doctor]

      if (doctorInfo && !doctorInfo.isDirector && !doctorInfo.isSpecialRow) {
        if (!doctorInfo.shifts[date]) {
          doctorInfo.shifts[date] = { morning: 'off', afternoon: 'off' }
        }
        doctorInfo.shifts[date] = {
          morning: 'work',
          afternoon: 'work'
        }
        doctorInfo.departmentsByDate[date] = {
          morning: '1诊室',
          afternoon: '1诊室'
        }
        if (!doctorInfo.nightShiftsByDate) {
          doctorInfo.nightShiftsByDate = {}
        }
        doctorInfo.nightShiftsByDate[date] = true
        doctorInfo.nightShifts = (doctorInfo.nightShifts || 0) + 1

        const existingMorningSlot = newScheduleData.schedule[date]['1诊室'].find(
          (slot: any) => slot.doctor === doctor && slot.shift === 'morning'
        )
        const existingAfternoonSlot = newScheduleData.schedule[date]['1诊室'].find(
          (slot: any) => slot.doctor === doctor && slot.shift === 'afternoon'
        )
        if (!existingMorningSlot) {
          newScheduleData.schedule[date]['1诊室'].push({
            doctor,
            shift: 'morning',
            department: '1诊室'
          })
        }
        if (!existingAfternoonSlot) {
          newScheduleData.schedule[date]['1诊室'].push({
            doctor,
            shift: 'afternoon',
            department: '1诊室'
          })
        }

        newScheduleData.dutySchedule[date] = doctor

        if (!(doctorInfo as any).morningShiftDays) {
          (doctorInfo as any).morningShiftDays = 0
        }
        if (!(doctorInfo as any).afternoonShiftDays) {
          (doctorInfo as any).afternoonShiftDays = 0
        }
        const daysToAdd = 0.5
        if (typeof (doctorInfo as any).morningShiftDays === 'number') {
          (doctorInfo as any).morningShiftDays = (doctorInfo as any).morningShiftDays + daysToAdd
        }
        if (typeof (doctorInfo as any).afternoonShiftDays === 'number') {
          (doctorInfo as any).afternoonShiftDays = (doctorInfo as any).afternoonShiftDays + daysToAdd
        }
        if (typeof doctorInfo.restDays === 'number') {
          doctorInfo.restDays = Math.max(0, doctorInfo.restDays - 1)
        }
      }
    })

    // 🔴 修改：自动填充一线夜（支持循环分配）
    if (firstNightShiftInfo) {
      selectedDutyDoctors.forEach((doctor, index) => {
        // 使用取模运算实现循环分配
        const date = dates[index % dates.length]
        firstNightShiftInfo.departmentsByDate[date] = {
          morning: doctor,
          afternoon: ''
        }
      })
    }

    setScheduleData(newScheduleData)
  }

  // 监听值班医生选择变化
  useEffect(() => {
    updateDutySchedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDutyDoctors])

  // 处理单元格点击（医生排班表）
  const handleDoctorCellClick = (doctor: string, date: string) => {
    const schedule = scheduleData?.doctorSchedule[doctor]
    if (!schedule) return

    const hasNightShift = (schedule as any)?.nightShiftsByDate?.[date]

    // 值班医生不能修改
    if (hasNightShift) {
      Taro.showToast({
        title: '值班医生不能修改',
        icon: 'none'
      })
      return
    }

    setEditingCell({ type: 'doctor', key1: doctor, key2: date })
    const dept = (schedule as any)?.departmentsByDate?.[date]?.morning || '请输入'
    setSelectedDepartment(dept)
    setSelectedShiftType('full')
    setShowCellEditModal(true)
  }

  // 处理科室/休息选择（仅用于医生排班表）
  const handleDepartmentSelect = (department: string) => {
    if (!editingCell || !scheduleData) return

    // 科室排班表现在直接选择医生，不再走这个逻辑
    if (editingCell.type !== 'doctor') {
      setShowCellEditModal(false)
      setEditingCell(null)
      return
    }

    const newScheduleData = { ...scheduleData }

    // 修改医生排班表
    const doctor = editingCell.key1
    const date = editingCell.key2
    const doctorInfo = newScheduleData.doctorSchedule[doctor]
    const oldShifts = doctorInfo.shifts[date]
    const oldDepartments = (doctorInfo as any).departmentsByDate[date]

    // 确保 morningShiftDays 和 afternoonShiftDays 字段存在
    if (!(doctorInfo as any).morningShiftDays) {
      (doctorInfo as any).morningShiftDays = 0
    }
    if (!(doctorInfo as any).afternoonShiftDays) {
      (doctorInfo as any).afternoonShiftDays = 0
    }

    // 更新医生的排班信息
    if (department === '休息') {
      // 全天休息
      doctorInfo.shifts[date] = {
        morning: 'off',
        afternoon: 'off'
      }
      ;(doctorInfo as any).departmentsByDate[date] = {
        morning: '休息',
        afternoon: '休息'
      }

      // 从科室排班表中移除上下午
      if (oldDepartments?.morning && oldDepartments.morning !== '休息' && oldDepartments.morning !== '请假') {
        newScheduleData.schedule[date][oldDepartments.morning] = newScheduleData.schedule[date][oldDepartments.morning].filter(
          slot => slot.doctor !== doctor || slot.shift === 'afternoon'
        )
      }
      if (oldDepartments?.afternoon && oldDepartments.afternoon !== '休息' && oldDepartments.afternoon !== '请假') {
        newScheduleData.schedule[date][oldDepartments.afternoon] = newScheduleData.schedule[date][oldDepartments.afternoon].filter(
          slot => slot.doctor !== doctor || slot.shift === 'morning'
        )
      }

      // 更新统计数据
      if (oldShifts?.morning === 'work') {
        ;(doctorInfo as any).morningShiftDays = Math.max(0, (doctorInfo as any).morningShiftDays - 0.5)
        doctorInfo.restDays = (doctorInfo.restDays || 0) + 0.5
      }
      if (oldShifts?.afternoon === 'work') {
        ;(doctorInfo as any).afternoonShiftDays = Math.max(0, (doctorInfo as any).afternoonShiftDays - 0.5)
        doctorInfo.restDays = (doctorInfo.restDays || 0) + 0.5
      }
    } else if (department === '请假') {
      // 全天请假
      doctorInfo.shifts[date] = {
        morning: 'off',
        afternoon: 'off'
      }
      ;(doctorInfo as any).departmentsByDate[date] = {
        morning: '请假',
        afternoon: '请假'
      }

      // 从科室排班表中移除上下午
      if (oldDepartments?.morning && oldDepartments.morning !== '休息' && oldDepartments.morning !== '请假') {
        newScheduleData.schedule[date][oldDepartments.morning] = newScheduleData.schedule[date][oldDepartments.morning].filter(
          slot => slot.doctor !== doctor || slot.shift === 'afternoon'
        )
      }
      if (oldDepartments?.afternoon && oldDepartments.afternoon !== '休息' && oldDepartments.afternoon !== '请假') {
        newScheduleData.schedule[date][oldDepartments.afternoon] = newScheduleData.schedule[date][oldDepartments.afternoon].filter(
          slot => slot.doctor !== doctor || slot.shift === 'morning'
        )
      }

      // 请假不更新休息天数（额外休息，不算在每周一天的休息要求中）
    } else if (department === '请输入') {
      // 清空科室设置（不限制）
      doctorInfo.shifts[date] = {
        morning: 'off',
        afternoon: 'off'
      }
      ;(doctorInfo as any).departmentsByDate[date] = {
        morning: '请输入',
        afternoon: '请输入'
      }

      // 从科室排班表中移除上下午
      if (oldDepartments?.morning && oldDepartments.morning !== '休息' && oldDepartments.morning !== '请假' && oldDepartments.morning !== '请输入') {
        newScheduleData.schedule[date][oldDepartments.morning] = newScheduleData.schedule[date][oldDepartments.morning].filter(
          slot => slot.doctor !== doctor || slot.shift === 'afternoon'
        )
      }
      if (oldDepartments?.afternoon && oldDepartments.afternoon !== '休息' && oldDepartments.afternoon !== '请假' && oldDepartments.afternoon !== '请输入') {
        newScheduleData.schedule[date][oldDepartments.afternoon] = newScheduleData.schedule[date][oldDepartments.afternoon].filter(
          slot => slot.doctor !== doctor || slot.shift === 'morning'
        )
      }

      // 不更新统计数据
    } else {
      // 设置科室（根据选择的班次类型）
      const isMorning = selectedShiftType === 'full' || selectedShiftType === 'morning'
      const isAfternoon = selectedShiftType === 'full' || selectedShiftType === 'afternoon'

      if (isMorning) {
        doctorInfo.shifts[date].morning = 'work'
        ;(doctorInfo as any).departmentsByDate[date].morning = department

        // 从旧科室移除上午班次
        if (oldDepartments?.morning && oldDepartments.morning !== '休息' && oldDepartments.morning !== department) {
          newScheduleData.schedule[date][oldDepartments.morning] = newScheduleData.schedule[date][oldDepartments.morning].filter(
            slot => !(slot.doctor === doctor && slot.shift === 'morning')
          )
        }

        // 添加到新科室上午
        const existingSlot = newScheduleData.schedule[date][department].find(s => s.doctor === doctor && s.shift === 'morning')
        if (!existingSlot) {
          newScheduleData.schedule[date][department].push({
            doctor,
            shift: 'morning',
            department
          })
        }

        // 更新统计数据
        if (oldShifts?.morning !== 'work') {
          (doctorInfo as any).morningShiftDays = ((doctorInfo as any).morningShiftDays || 0) + 0.5
          doctorInfo.restDays = Math.max(0, (doctorInfo.restDays || 0) - 0.5)
        }
      }

      if (isAfternoon) {
        doctorInfo.shifts[date].afternoon = 'work'
        ;(doctorInfo as any).departmentsByDate[date].afternoon = department

        // 从旧科室移除下午班次
        if (oldDepartments?.afternoon && oldDepartments.afternoon !== '休息' && oldDepartments.afternoon !== department) {
          newScheduleData.schedule[date][oldDepartments.afternoon] = newScheduleData.schedule[date][oldDepartments.afternoon].filter(
            slot => !(slot.doctor === doctor && slot.shift === 'afternoon')
          )
        }

        // 添加到新科室下午
        const existingSlot = newScheduleData.schedule[date][department].find(s => s.doctor === doctor && s.shift === 'afternoon')
        if (!existingSlot) {
          newScheduleData.schedule[date][department].push({
            doctor,
            shift: 'afternoon',
            department
          })
        }

        // 更新统计数据
        if (oldShifts?.afternoon !== 'work') {
          (doctorInfo as any).afternoonShiftDays = ((doctorInfo as any).afternoonShiftDays || 0) + 0.5
          doctorInfo.restDays = Math.max(0, (doctorInfo.restDays || 0) - 0.5)
        }
      }
    }

    setScheduleData(newScheduleData)
    setShowCellEditModal(false)
    setEditingCell(null)
    setSelectedDepartment('')
    setSelectedShiftType('full')

    Taro.showToast({
      title: '修改成功',
      icon: 'success'
    })
  }

  // 🔴 处理夜班医生选择（用于一线夜和二线夜）
  const handleNightDoctorSelect = (doctorName: string) => {
    if (!editingCell || !scheduleData) return

    const newScheduleData = { ...scheduleData }
    const rowName = editingCell.key1 // '一线夜' 或 '二线夜'
    const date = editingCell.key2

    // 更新特殊行的数据
    newScheduleData.doctorSchedule[rowName].departmentsByDate[date] = {
      morning: doctorName,
      afternoon: ''
    }

    setScheduleData(newScheduleData)
    setShowDoctorSelector(false)
    setEditingCell(null)
    setSelectedDoctor('')

    Taro.showToast({
      title: '修改成功',
      icon: 'success'
    })
  }

  // 自动填充排班（优化版：添加重试机制）
  const handleAutoFillSchedule = async () => {
    if (!startDate || !endDate) {
      Taro.showToast({
        title: '请选择开始和结束日期',
        icon: 'none'
      })
      return
    }

    // 🔴 修改：验证值班医生至少7位（值班医生第二天必须休息，可以循环分配）
    if (selectedDutyDoctors.length < 7) {
      Taro.showToast({
        title: '请选择至少7位值班医生',
        icon: 'none'
      })
      return
    }

    if (!scheduleData) {
      Taro.showToast({
        title: '请先初始化排班表',
        icon: 'none'
      })
      return
    }

    setLoading(true)

    // 🔴 保存特殊行的数据（一线夜、二线夜、三线夜、补休、其他）
    const specialRows = ['一线夜', '二线夜', '三线夜', '补休', '其他']
    const specialRowsData: Record<string, any> = {}
    specialRows.forEach(rowName => {
      if (scheduleData?.doctorSchedule[rowName]) {
        specialRowsData[rowName] = {
          name: rowName,
          shifts: {},
          departmentsByDate: {},
          isSpecialRow: true
        }
        scheduleData.dates.forEach(date => {
          specialRowsData[rowName].shifts[date] = { ...scheduleData.doctorSchedule[rowName].shifts[date] }
          specialRowsData[rowName].departmentsByDate[date] = { ...scheduleData.doctorSchedule[rowName].departmentsByDate[date] }
        })
      }
    })

    // 🔴 保存邓旦医生的数据
    const dengDanData = {
      name: '邓旦',
      shifts: {},
      departmentsByDate: {},
      isDirector: true
    }
    if (scheduleData?.doctorSchedule['邓旦']) {
      scheduleData.dates.forEach(date => {
        dengDanData.shifts[date] = { ...scheduleData.doctorSchedule['邓旦'].shifts[date] }
        dengDanData.departmentsByDate[date] = { ...scheduleData.doctorSchedule['邓旦'].departmentsByDate[date] }
      })
    }

    // 🔴 CRITICAL: 将当前的固定排班转换为后端需要的格式（支持半天班次）
    const fixedSchedule: Record<string, Record<string, {
      morning: string | '请输入' | '休息' | '请假'
      afternoon: string | '请输入' | '休息' | '请假'
    }>> = {}

    // 遍历医生排班表，提取每个医生每天的固定排班（排除特殊行和邓旦）
    Object.entries(scheduleData.doctorSchedule).forEach(([doctor, doctorInfo]) => {
      // 跳过特殊行和邓旦医生
      if ((doctorInfo as any).isSpecialRow || (doctorInfo as any).isDirector) {
        return
      }

      const shifts = doctorInfo.shifts
      const departmentsByDate = (doctorInfo as any).departmentsByDate

      Object.keys(shifts).forEach(date => {
        const shift = shifts[date]
        const dept = departmentsByDate[date]

        // 只保留有固定排班的日期（包括休息、请假）
        if (shift && dept && (dept.morning !== '请输入' || dept.afternoon !== '请输入')) {
          if (!fixedSchedule[date]) {
            fixedSchedule[date] = {}
          }

          fixedSchedule[date][doctor] = {
            morning: dept.morning === '请输入' ? '休息' : dept.morning,
            afternoon: dept.afternoon === '请输入' ? '休息' : dept.afternoon
          }
        }
      })
    })

    console.log('固定排班数据:', fixedSchedule)

    // 🔴 优化：添加重试机制（Railway 服务器可能休眠）
    const maxRetries = 3
    const retryDelay = 2000 // 2 秒

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        console.log(`尝试第 ${retry + 1} 次自动填充排班，参数:`, { startDate, endDate, selectedDutyDoctors, selectedDepartments })

        const res = await Network.request({
          url: '/api/schedule/generate',
          method: 'POST',
          data: {
            startDate,
            endDate, // 🔴 新增：传递结束日期
            dutyDoctors: selectedDutyDoctors,
            selectedDepartments,
            fixedSchedule
          }
        })
    console.log('排班生成响应:', res.data)

        if (res.data.code === 200) {
          // 🔴 恢复特殊行的数据（一线夜、二线夜、三线夜、补休、其他）
          // 如果后端返回的数据中特殊行的 departmentsByDate 为空，则恢复前端保存的数据
          const newScheduleData = { ...res.data.data }
          specialRows.forEach(rowName => {
            if (specialRowsData[rowName] && newScheduleData.doctorSchedule[rowName]) {
              const backendData = newScheduleData.doctorSchedule[rowName].departmentsByDate
              // 检查后端返回的特殊行数据是否为空（所有日期都是空的）
              const isEmpty = scheduleData.dates.every(
                date => !backendData[date]?.morning && !backendData[date]?.afternoon
              )
              // 如果后端数据为空，则恢复前端保存的数据
              if (isEmpty || (rowName === '三线夜' && backendData[scheduleData.dates[0]]?.morning !== '邓旦')) {
                newScheduleData.doctorSchedule[rowName] = specialRowsData[rowName]
              }
            }
          })

          // 🔴 恢复邓旦医生的数据
          newScheduleData.doctorSchedule['邓旦'] = dengDanData

          setScheduleData(newScheduleData)
          setLoading(false)
          Taro.showToast({
            title: '自动填充成功',
            icon: 'success'
          })
          return
        } else {
          // 后端返回错误
          setLoading(false)
          Taro.showToast({
            title: res.data.msg || '自动填充失败',
            icon: 'none'
          })
          return
        }
      } catch (error: any) {
        console.error(`第 ${retry + 1} 次请求失败:`, error)

        // 如果是最后一次重试，直接报错
        if (retry === maxRetries - 1) {
          console.error('自动填充失败（已重试 3 次）:', error)
          setLoading(false)
          Taro.showToast({
            title: error?.message || '网络错误，请稍后重试',
            icon: 'none',
            duration: 3000
          })
          return
        }

        // 否则等待后重试
        console.log(`等待 ${retryDelay}ms 后重试...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }

    setLoading(false)
  }

  // 下载doc文档
  const handleDownloadDoc = async () => {
    if (!scheduleData) {
      Taro.showToast({
        title: '请先设置排班',
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
        const base64Data = res.data.data.fileData
        const fileName = res.data.data.fileName

        const env = Taro.getEnv()
        
        if (env === Taro.ENV_TYPE.WEAPP) {
          // 小程序端下载
          try {
            // 先提示用户如何保存（更详细的说明）
            Taro.showModal({
              title: '保存文档到手机',
              content: '文档即将在微信中预览。\n\n重要提示：\n文档打开后，请点击【右上角的三个点 ···】菜单，然后选择【用其他应用打开】或【保存到手机】，即可将文档保存到手机存储中。',
              showCancel: false,
              confirmText: '打开文档',
              success: () => {
                // 用户点击确认后，打开文档
                const fs = Taro.getFileSystemManager()
                const filePath = `${Taro.env.USER_DATA_PATH}/${fileName}`
                
                // 将 base64 写入文件
                fs.writeFile({
                  filePath,
                  data: base64Data,
                  encoding: 'base64',
                  success: () => {
                    console.log('文件写入成功:', filePath)
                    // 打开文档
                    Taro.openDocument({
                      filePath,
                      fileType: 'docx',
                      showMenu: true, // 确保显示右上角菜单
                      success: () => {
                        console.log('文档打开成功')
                      },
                      fail: (error) => {
                        console.error('文档打开失败:', error)
                        Taro.showToast({
                          title: '文档打开失败',
                          icon: 'none',
                          duration: 3000
                        })
                      }
                    })
                  },
                  fail: (error) => {
                    console.error('文件写入失败:', error)
                    Taro.showToast({
                      title: '文件写入失败',
                      icon: 'none',
                      duration: 3000
                    })
                  }
                })
              }
            })
          } catch (error) {
            console.error('小程序下载失败:', error)
            Taro.showToast({
              title: '下载失败',
              icon: 'none',
              duration: 3000
            })
          }
        } else if (env === Taro.ENV_TYPE.WEB) {
          // H5 端下载
          const link = document.createElement('a')
          link.href = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${base64Data}`
          link.download = fileName
          link.click()
          Taro.showToast({
            title: '文档下载成功',
            icon: 'success'
          })
        } else {
          Taro.showToast({
            title: '当前环境不支持下载',
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

  // 重置排班
  const handleResetSchedule = () => {
    Taro.showModal({
      title: '确认重置',
      content: '确定要重置所有排班数据吗？所有已设置的排班将被清空。',
      success: (res) => {
        if (res.confirm) {
          // 重新初始化空排班
          initializeEmptySchedule()
          Taro.showToast({
            title: '重置成功',
            icon: 'success'
          })
        }
      }
    })
  }

  // 选择值班起始医生
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
                onChange={(e) => {
                  const newStartDate = e.detail.value
                  setStartDate(newStartDate)
                  // 🔴 修改：自动计算该周的周日作为结束日期
                  const newEndDate = getSundayOfWeek(newStartDate)
                  setEndDate(newEndDate)
                  // 🔴 修改：立即重新初始化空排班，移除setTimeout
                  initializeEmptySchedule()
                }}
              >
                <Text className="block text-sm">{startDate || '请选择日期'}</Text>
              </Picker>
            </View>
          </View>

          {/* 🔴 结束日期选择 */}
          <View className="flex flex-row items-center gap-2">
            <Text className="block text-sm font-medium w-24">结束日期：</Text>
            <View className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
              <Picker
                mode="date"
                value={endDate}
                onChange={(e) => {
                  const newEndDate = e.detail.value
                  // 验证日期范围
                  if (startDate) {
                    const start = new Date(startDate)
                    const end = new Date(newEndDate)
                    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

                    if (diffDays < 1) {
                      Taro.showToast({
                        title: '结束日期不能早于开始日期',
                        icon: 'none'
                      })
                      return
                    }

                    if (diffDays > 14) {
                      Taro.showToast({
                        title: '最多只能排14天班',
                        icon: 'none'
                      })
                      return
                    }
                  }
                  setEndDate(newEndDate)
                  // 🔴 修改：立即重新初始化空排班，移除setTimeout
                  initializeEmptySchedule()
                }}
              >
                <Text className="block text-sm">{endDate || '请选择日期'}</Text>
              </Picker>
            </View>
          </View>

          {/* 固定医生列表和值班医生选择 */}
          <View className="flex flex-col gap-2 mt-2">
            <Text className="block text-sm font-medium text-gray-700">排班医生：</Text>
            <View className="bg-gray-50 rounded-lg p-3">
              <Text className="block text-xs text-gray-600 mb-2">点击选择值班医生（按选择的顺序值班，至少7位）：</Text>
              <View className="flex flex-row flex-wrap gap-2">
                {FIXED_DOCTORS.filter(doctor => doctor !== '邓旦').map((doctor) => (
                  <View
                    key={doctor}
                    className={`px-2 py-1 rounded text-xs cursor-pointer ${
                      selectedDutyDoctors.includes(doctor)
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-white text-gray-600 border border-gray-300'
                    }`}
                    onTap={() => {
                      if (selectedDutyDoctors.includes(doctor)) {
                        // 取消选择
                        setSelectedDutyDoctors(selectedDutyDoctors.filter(d => d !== doctor))
                      } else {
                        // 🔴 修改：不再限制最大数量，允许超过7位
                        // 添加到值班医生列表
                        setSelectedDutyDoctors([...selectedDutyDoctors, doctor])
                      }
                    }}
                  >
                    <Text className="block text-xs">{doctor}</Text>
                  </View>
                ))}
              </View>
              {selectedDutyDoctors.length > 0 && (
                <Text className="block text-xs text-blue-600 mt-2">
                  已选择值班医生（{selectedDutyDoctors.length}位）：{selectedDutyDoctors.join(' → ')}
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {scheduleData && (
        <View className="p-4">
          {/* 医生排班表（可编辑） */}
          <Text className="block text-lg font-bold mb-3">医生排班表</Text>
          <View className="bg-white rounded-lg p-4 mb-6 shadow-sm">
            <Text className="block text-sm text-gray-500 mb-2">点击单元格设置科室或休息</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-purple-50 p-2 border border-gray-200" style={{ position: 'sticky', left: 0, zIndex: 10, backgroundColor: '#f5f3ff' }}>
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
                {[...FIXED_DOCTORS.filter(d => d !== '邓旦'), '邓旦', '一线夜', '二线夜', '三线夜', '补休', '其他'].map((doctor) => {
                  const schedule = scheduleData.doctorSchedule[doctor]
                  const isDirector = (schedule as any)?.isDirector
                  const isSpecialRow = (schedule as any)?.isSpecialRow
                  const isThirdNight = doctor === '三线夜'

                  return (
                    <View key={doctor} className="flex flex-row">
                      <View
                        className={`w-24 p-2 border border-gray-200 ${isDirector ? 'bg-yellow-50' : isSpecialRow ? 'bg-green-50' : 'bg-gray-50'}`}
                        style={{ position: 'sticky', left: 0, zIndex: 10, backgroundColor: isDirector ? '#fefce8' : isSpecialRow ? '#f0fdf4' : '#f9fafb' }}
                      >
                        <Text className={`block text-sm font-medium text-center ${isDirector ? 'text-yellow-700' : isSpecialRow ? 'text-green-700' : ''}`}>
                          {doctor}{selectedDutyDoctors.includes(doctor) && !isDirector && !isSpecialRow ? ' ⭐' : ''}
                        </Text>
                      </View>
                      {scheduleData.dates.map((date) => {
                        const shifts = schedule?.shifts[date] || { morning: 'off', afternoon: 'off' }
                        const departments = (schedule as any)?.departmentsByDate?.[date] || { morning: '请输入', afternoon: '请输入' }
                        const hasNightShift = (schedule as any)?.nightShiftsByDate?.[date]

                        // 邓旦医生（科室主任）：不排班，显示为空
                        if (isDirector) {
                          return (
                            <View key={date} className="w-24 p-2 border border-gray-200 min-h-[50px] flex items-center justify-center bg-gray-50">
                              <Text className="text-xs text-center text-gray-300">-</Text>
                            </View>
                          )
                        }

                        // 特殊行处理
                        if (isSpecialRow) {
                          if (isThirdNight) {
                            // 三线夜：显示邓旦
                            return (
                              <View key={date} className="w-24 p-2 border border-gray-200 min-h-[50px] flex items-center justify-center">
                                <Text className="text-xs text-center text-green-700">邓旦</Text>
                              </View>
                            )
                          } else if (doctor === '补休' || doctor === '其他') {
                            // 补休和其他：多行输入框
                            return (
                              <View key={date} className="w-24 p-2 border border-gray-200 min-h-[80px] flex items-center justify-center">
                                <Textarea
                                  className="w-full text-xs text-center bg-transparent border-none outline-none resize-none"
                                  placeholder="输入"
                                  value={departments.morning || ''}
                                  maxlength={200}
                                  autoHeight={false}
                                  adjustPosition={false}
                                  onInput={(e: any) => {
                                    const newScheduleData = { ...scheduleData }
                                    newScheduleData.doctorSchedule[doctor].departmentsByDate[date] = {
                                      morning: e.detail.value,
                                      afternoon: ''
                                    }
                                    setScheduleData(newScheduleData)
                                  }}
                                />
                              </View>
                            )
                          } else {
                            // 一线夜和二线夜：可选择医生
                            return (
                              <View
                                key={date}
                                className="w-24 p-2 border border-gray-200 min-h-[50px] flex items-center justify-center cursor-pointer active:bg-green-50"
                                onTap={() => {
                                  // 打开医生选择弹窗
                                  setEditingCell({ type: 'night_doctor', key1: doctor, key2: date })
                                  const selectedDoc = departments.morning || ''
                                  setSelectedDoctor(selectedDoc)
                                  setShowDoctorSelector(true)
                                }}
                              >
                                <Text className={`text-xs text-center whitespace-pre-line ${departments.morning ? 'text-green-600' : 'text-gray-300'}`}>
                                  {departments.morning || '选择医生'}
                                </Text>
                              </View>
                            )
                          }
                        }

                        // 普通医生：正常排班逻辑
                        
                        let shiftText = ''
                        let shiftColor = 'text-gray-400'

                        if (hasNightShift) {
                          // 获取值班医生当天的科室（值班医生在白天也有排班）
                          const dutyDepartment = departments.morning || departments.afternoon || ''
                          shiftText = dutyDepartment ? `${dutyDepartment}（值班）` : '值班'
                          shiftColor = 'text-red-600'
                        } else {
                          // 上下午班次显示
                          if (shifts.morning === 'off' && shifts.afternoon === 'off') {
                            // 全天休息
                            // 检查是否是"休息"或"请假"
                            const morningDept = departments.morning
                            const afternoonDept = departments.afternoon
                            
                            if (morningDept === '休息' && afternoonDept === '休息') {
                              shiftText = '休息'
                              shiftColor = 'text-gray-500'
                            } else if (morningDept === '请假' && afternoonDept === '请假') {
                              shiftText = '请假'
                              shiftColor = 'text-orange-600'
                            } else if (morningDept === '请输入' && afternoonDept === '请输入') {
                              shiftText = '请输入'
                              shiftColor = 'text-gray-300'
                            } else {
                              // 混合状态（如上午休息，下午请假等）
                              shiftText = `${morningDept}\n${afternoonDept}`
                              shiftColor = 'text-orange-600'
                            }
                          } else if (shifts.morning === 'work' && shifts.afternoon === 'work') {
                            // 全天上班
                            if (departments.morning === departments.afternoon) {
                              shiftText = departments.morning
                            } else {
                              shiftText = `${departments.morning}\n${departments.afternoon}`
                            }
                            shiftColor = 'text-blue-600'
                          } else {
                            // 半天上班
                            shiftText = shifts.morning === 'work' 
                              ? `上午：${departments.morning}\n下午：休息`
                              : `上午：休息\n下午：${departments.afternoon}`
                            shiftColor = 'text-orange-600'
                          }
                        }

                        // 5诊室标红（值班医生已标红，不再重复标红）
                        if (!hasNightShift) {
                          const morningDept = departments.morning
                          const afternoonDept = departments.afternoon
                          if (morningDept?.includes('5诊室') || afternoonDept?.includes('5诊室')) {
                            shiftColor = 'text-red-600'
                          }
                        }

                        return (
                          <View
                            key={date}
                            className={`w-24 p-2 border border-gray-200 min-h-[50px] flex items-center justify-center ${!hasNightShift ? 'cursor-pointer active:bg-blue-50' : ''}`}
                            onTap={() => !hasNightShift && handleDoctorCellClick(doctor, date)}
                          >
                            <Text className={`text-xs text-center whitespace-pre-line ${shiftColor}`}>
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

          {/* 科室排班表（只展示） */}
          <Text className="block text-lg font-bold mb-3 mt-6 hidden">科室排班表</Text>
          <View className="bg-white rounded-lg p-4 mb-6 shadow-sm hidden">
            <Text className="block text-sm text-gray-500 mb-2">根据医生排班自动生成，不可编辑</Text>
            <ScrollView scrollX className="w-full overflow-x-auto">
              <View className="min-w-max">
                {/* 表头 */}
                <View className="flex flex-row">
                  <View className="w-24 bg-blue-50 p-2 border border-gray-200" style={{ position: 'sticky', left: 0, zIndex: 10, backgroundColor: '#eff6ff' }}>
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
                    <View className="w-24 bg-gray-50 p-2 border border-gray-200" style={{ position: 'sticky', left: 0, zIndex: 10, backgroundColor: '#f9fafb' }}>
                      <Text className="block text-sm font-medium text-center">{department}</Text>
                    </View>
                    {scheduleData.dates.map((date) => {
                      const slots = scheduleData.schedule[date]?.[department] || []

                      // 优化显示：如果上下午是同一个医生，只显示一次名字
                      let slotText = ''
                      let slotColor = 'text-gray-800'

                      // 检查该科室是否有值班医生
                      const dutyDoctor = scheduleData.dutySchedule[date]
                      const dutyDoctorInDept = slots.some(slot => slot.doctor === dutyDoctor)

                      if (slots.length === 0) {
                        slotText = '休息'
                        slotColor = 'text-gray-400'
                      } else if (slots.length === 1) {
                        const suffix = slots[0].shift === 'morning' ? '（上午）' : '（下午）'
                        slotText = `${slots[0].doctor}${suffix}`
                        if (dutyDoctorInDept) {
                          slotText = `${slots[0].doctor}（值班）`
                          slotColor = 'text-red-600'
                        }
                      } else if (slots.length === 2) {
                        if (slots[0].doctor === slots[1].doctor) {
                          slotText = slots[0].doctor
                          if (dutyDoctorInDept) {
                            slotText = `${slots[0].doctor}（值班）`
                            slotColor = 'text-red-600'
                          }
                        } else {
                          slotText = slots.map(s => {
                            const suffix = s.shift === 'morning' ? '（上午）' : '（下午）'
                            const isDuty = s.doctor === dutyDoctor
                            return `${s.doctor}${isDuty ? '（值班）' : suffix}`
                          }).join('\n')
                          if (dutyDoctorInDept) {
                            slotColor = 'text-red-600'
                          }
                        }
                      }

                      return (
                        <View
                          key={date}
                          className="w-32 p-2 border border-gray-200 min-h-[60px] flex items-center justify-center bg-white"
                        >
                          <Text className={`text-xs text-center whitespace-pre-line ${slotColor}`}>
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
                    <Text className="block text-xs font-bold text-center">上午班(次)</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">下午班(次)</Text>
                  </View>
                  <View className="w-20 bg-green-50 p-2 border border-gray-200">
                    <Text className="block text-xs font-bold text-center">休息天数</Text>
                  </View>
                </View>

                {/* 表格内容 */}
                {FIXED_DOCTORS.filter(d => d !== '邓旦').map((doctorName) => {
                  const info = scheduleData.doctorSchedule[doctorName]
                  if (!info) return null

                  const morningShifts = ((info as any).morningShiftDays || info.morningShifts.length) * 2
                  const afternoonShifts = ((info as any).afternoonShiftDays || info.afternoonShifts.length) * 2
                  const restDays = 7 - (morningShifts + afternoonShifts) / 2
                  
                  return (
                    <View key={info.name} className="flex flex-row">
                      <View className="w-24 bg-gray-50 p-2 border border-gray-200">
                        <Text className="block text-sm font-medium text-center">{info.name}</Text>
                      </View>
                      <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                        <Text className="block text-xs">{info.nightShifts}</Text>
                      </View>
                      <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                        <Text className="block text-xs">{morningShifts}</Text>
                      </View>
                      <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                        <Text className="block text-xs">{afternoonShifts}</Text>
                      </View>
                      <View className="w-20 p-2 border border-gray-200 flex items-center justify-center">
                        <Text className={`block text-xs ${restDays >= 2 ? 'text-green-600' : 'text-red-600'}`}>
                          {restDays % 1 === 0 ? restDays : restDays.toFixed(1)}
                        </Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            </ScrollView>
          </View>

          {/* 操作按钮 */}
          <View className="flex flex-row gap-2 mt-6 mb-4">
            <Button
              className="flex-1 bg-purple-500 text-white rounded-lg py-3"
              onTap={() => setShowDepartmentSelector(true)}
            >
              科室设置
            </Button>
            <Button
              className="flex-1 bg-blue-500 text-white rounded-lg py-3"
              onClick={handleAutoFillSchedule}
              disabled={loading}
            >
              {loading ? '填充中...' : '自动填充'}
            </Button>
          </View>
          <View className="flex flex-row gap-2 mb-4">
            <Button
              className="flex-1 bg-green-500 text-white rounded-lg py-3"
              onTap={handleDownloadDoc}
              disabled={!scheduleData}
            >
              下载文档
            </Button>
            <Button
              className="flex-1 bg-red-500 text-white rounded-lg py-3"
              onTap={handleResetSchedule}
            >
              重置
            </Button>
          </View>

          <View className="mt-4 mb-20 text-center">
            <Text className="block text-xs text-gray-500">
              1. 点击表格单元格手动设置固定排班
              2. 3个表格自动关联更新
              3. 点击&ldquo;自动填充&rdquo;按钮系统填充剩余空位
              4. 确认无误后点击&ldquo;下载文档&rdquo;导出Word格式
            </Text>
          </View>
        </View>
      )}

      {/* 科室/休息选择弹窗（仅用于医生排班表） */}
      {showCellEditModal && editingCell && editingCell.type === 'doctor' && (
        <View className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <View className="bg-white rounded-lg p-6 mx-4 w-80 max-h-[80vh] overflow-y-auto">
            <Text className="block text-lg font-bold mb-4 text-center">
              设置排班
            </Text>
            
            {/* 班次类型选择 */}
            <View className="mb-4">
              <Text className="block text-sm text-gray-600 mb-2">
                选择班次：
              </Text>
              <View className="flex flex-row gap-2">
                <View
                  className={`flex-1 p-2 border rounded-lg text-center text-xs ${selectedShiftType === 'full' ? 'bg-blue-50 border-blue-500' : 'border-gray-300'}`}
                  onTap={() => setSelectedShiftType('full')}
                >
                  <Text className={`block text-sm ${selectedShiftType === 'full' ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                    全天
                  </Text>
                </View>
                <View
                  className={`flex-1 p-2 border rounded-lg text-center text-xs ${selectedShiftType === 'morning' ? 'bg-blue-50 border-blue-500' : 'border-gray-300'}`}
                  onTap={() => setSelectedShiftType('morning')}
                >
                  <Text className={`block text-sm ${selectedShiftType === 'morning' ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                    上午
                  </Text>
                </View>
                <View
                  className={`flex-1 p-2 border rounded-lg text-center text-xs ${selectedShiftType === 'afternoon' ? 'bg-blue-50 border-blue-500' : 'border-gray-300'}`}
                  onTap={() => setSelectedShiftType('afternoon')}
                >
                  <Text className={`block text-sm ${selectedShiftType === 'afternoon' ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
                    下午
                  </Text>
                </View>
              </View>
            </View>
            
            <View className="mb-4">
              <Text className="block text-sm text-gray-600 mb-4">
                选择科室或状态：
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
                <View
                  className={`w-full p-3 border rounded-lg text-center ${selectedDepartment === '请假' ? 'bg-orange-50 border-orange-500' : 'border-gray-300'}`}
                  onTap={() => handleDepartmentSelect('请假')}
                >
                  <Text className={`block text-sm ${selectedDepartment === '请假' ? 'text-orange-600 font-medium' : 'text-gray-600'}`}>
                    请假
                  </Text>
                </View>
                {DOCTOR_DEPARTMENTS.map((dept) => (
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
                  setSelectedShiftType('full')
                }}
              >
                <Text className="block text-sm font-medium">取消</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 🔴 夜班医生选择弹窗（用于一线夜和二线夜） */}
      {showDoctorSelector && editingCell && editingCell.type === 'night_doctor' && (
        <View className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <View className="bg-white rounded-lg p-6 mx-4 w-80">
            <Text className="block text-lg font-bold mb-4 text-center">
              选择夜班医生
            </Text>
            
            <View className="flex flex-col gap-2 mb-4">
              <Text className="block text-sm text-gray-600 mb-2">
                请选择{editingCell.key1 === '一线夜' ? '一线夜' : '二线夜'}医生：
              </Text>
              {NIGHT_DOCTORS.map((doctor) => (
                <View
                  key={doctor}
                  className={`w-full p-3 border rounded-lg text-center ${selectedDoctor === doctor ? 'bg-green-50 border-green-500' : 'border-gray-300'}`}
                  onTap={() => handleNightDoctorSelect(doctor)}
                >
                  <Text className={`block text-sm ${selectedDoctor === doctor ? 'text-green-600 font-medium' : 'text-gray-600'}`}>
                    {doctor}
                  </Text>
                </View>
              ))}
              <View
                className={`w-full p-3 border rounded-lg text-center ${selectedDoctor === '' ? 'bg-gray-50 border-gray-400' : 'border-gray-300'}`}
                onTap={() => handleNightDoctorSelect('')}
              >
                <Text className={`block text-sm ${selectedDoctor === '' ? 'text-gray-600' : 'text-gray-400'}`}>
                  清空选择
                </Text>
              </View>
            </View>
            
            <View className="flex gap-3">
              <View
                className="flex-1 bg-gray-200 text-gray-700 rounded-lg py-3 text-center cursor-pointer"
                onTap={() => {
                  setShowDoctorSelector(false)
                  setEditingCell(null)
                  setSelectedDoctor('')
                }}
              >
                <Text className="block text-sm font-medium">取消</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 科室选择弹窗 */}
      <DepartmentSelector
        visible={showDepartmentSelector}
        onClose={() => setShowDepartmentSelector(false)}
        selectedDepartments={selectedDepartments}
        onDepartmentsChange={setSelectedDepartments}
      />
    </ScrollView>
  )
}

export default IndexPage
